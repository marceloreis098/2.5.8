import React, { useState, useRef, useMemo } from 'react';
import { User, Equipment } from '../types';
import Icon from './common/Icon';
import { importEquipment } from '../services/apiService';

type PartialEquipment = Partial<Equipment>;

const FileUploadBox: React.FC<{
    title: string;
    icon: any;
    file: File | null;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    isLoading: boolean;
}> = ({ title, icon, file, onFileChange, isLoading }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md border-l-4 border-brand-primary">
            <div className="flex items-center mb-3">
                <Icon name={icon} size={24} className="text-brand-primary mr-3" />
                <h3 className="text-xl font-bold text-brand-secondary dark:text-dark-text-primary">{title}</h3>
            </div>
            <input
                type="file"
                ref={inputRef}
                onChange={onFileChange}
                accept=".csv"
                className="hidden"
                disabled={isLoading}
            />
            <button
                onClick={() => inputRef.current?.click()}
                disabled={isLoading}
                className="w-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-dark-text-secondary px-4 py-3 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
                <Icon name="Upload" size={18} />
                <span>{file ? 'Trocar Arquivo' : 'Selecionar Arquivo CSV'}</span>
            </button>
            {file && (
                <div className="mt-3 text-sm text-gray-600 dark:text-dark-text-secondary">
                    <p><strong>Arquivo:</strong> {file.name}</p>
                </div>
            )}
        </div>
    );
};

interface DataConsolidationProps {
    currentUser: User;
    onImportSuccess: () => void;
}

const DataConsolidation: React.FC<DataConsolidationProps> = ({ currentUser, onImportSuccess }) => {
    const [baseFile, setBaseFile] = useState<File | null>(null);
    const [absoluteFile, setAbsoluteFile] = useState<File | null>(null);
    const [consolidatedData, setConsolidatedData] = useState<PartialEquipment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const splitCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuote = false;
        const separator = ',';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === separator && !inQuote) {
                result.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
    };

    const parseCsv = (fileText: string, mappings: { [key: string]: keyof Equipment }): PartialEquipment[] => {
        const lines = fileText.trim().split(/\r\n|\n/);
        if (lines.length < 2) throw new Error("O arquivo CSV deve conter um cabeçalho e pelo menos uma linha de dados.");

        const headerLine = lines[0].endsWith(',') ? lines[0].slice(0, -1) : lines[0];
        const header = splitCsvLine(headerLine).map(h => h.trim().toUpperCase());
        const rows = lines.slice(1);

        return rows.map(row => {
            if (!row.trim()) return null;

            const values = splitCsvLine(row);
            const entry: PartialEquipment = {};

            header.forEach((colName, index) => {
                const normalizedColName = colName.replace(/[\s/]+/g, '').toUpperCase();
                const mappedKey = mappings[normalizedColName] || mappings[colName.toUpperCase()];
                if (mappedKey && index < values.length) {
                    (entry as any)[mappedKey] = values[index]?.trim() || '';
                }
            });

            // Enforce that the serial number must exist and be non-empty for an item to be valid.
            if (!entry.serial || entry.serial.trim() === '') {
                return null;
            }
            return entry;
        }).filter((item): item is PartialEquipment => item !== null);
    };

    const handleConsolidate = async () => {
        if (!baseFile && !absoluteFile) {
            setError("Por favor, selecione pelo menos um arquivo (Planilha Base ou Relatório Absolute).");
            return;
        }

        setIsLoading(true);
        setError(null);
        setConsolidatedData([]);

        try {
            let finalData: PartialEquipment[] = [];
            let baseData: PartialEquipment[] = [];
            let absoluteData: PartialEquipment[] = [];

            if (baseFile) {
                const baseText = await baseFile.text();
                const baseMappings: { [key: string]: keyof Equipment } = {
                    'EQUIPAMENTO': 'equipamento', 'GARANTIA': 'garantia', 'PATRIMONIO': 'patrimonio', 'SERIAL': 'serial',
                    'USUÁRIO ATUAL': 'usuarioAtual', 'USUÁRIO ANTERIOR': 'usuarioAnterior', 'LOCAL': 'local', 'SETOR': 'setor',
                    'DATA ENTREGA O USUÁRIO': 'dataEntregaUsuario', 'STATUS': 'status', 'DATA DE DEVOLUÇÃO': 'dataDevolucao',
                    'TIPO': 'tipo', 'NOTA DE COMPRA': 'notaCompra', 'NOTA / PL K&M': 'notaPlKm',
                    'TERMO DE RESPONSABILIDADE': 'termoResponsabilidade', 'FOTO': 'foto', 'QR CODE': 'qrCode',
                    'MARCA': 'brand', 'MODELO': 'model', 'EMAIL COLABORADOR': 'emailColaborador',
                    // Novos campos - Planilha Base
                    'IDENTIFICADOR': 'identificador', 'NOME DO SO': 'nomeSO', 'MEMÓRIA FÍSICA TOTAL': 'memoriaFisicaTotal', 
                    'GRUPO DE POLÍTICAS': 'grupoPoliticas', 'PAÍS': 'pais', 'CIDADE': 'cidade', 'ESTADO/PROVÍNCIA': 'estadoProvincia'
                };
                baseData = parseCsv(baseText, baseMappings);
            }

            if (absoluteFile) {
                const absoluteText = await absoluteFile.text();
                const absoluteMappings: { [key: string]: keyof Equipment } = {
                    'NOMEDODISPOSITIVO': 'equipamento', 'NÚMERODESÉRIE': 'serial',
                    'NOMEDOUSUÁRIOATUAL': 'usuarioAtual', 'MARCA': 'brand', 'MODELO': 'model',
                    'EMAIL DO COLABORADOR': 'emailColaborador',
                    // Novos campos - Relatório Absolute
                    'IDENTIFICADOR': 'identificador', 'NOME DO SO': 'nomeSO', 'MEMÓRIA FÍSICA TOTAL': 'memoriaFisicaTotal', 
                    'GRUPO DE POLÍTICAS': 'grupoPoliticas', 'PAÍS': 'pais', 'CIDADE': 'cidade', 'ESTADO/PROVÍNCIA': 'estadoProvincia'
                };
                absoluteData = parseCsv(absoluteText, absoluteMappings);
            }

            if (baseFile && absoluteFile) {
                // Existing consolidation logic
                const consolidatedMap = new Map<string, PartialEquipment>();
                baseData.forEach(baseItem => {
                    const key = baseItem.serial!.toUpperCase().replace(/ /g, '');
                    consolidatedMap.set(key, baseItem);
                });
                absoluteData.forEach(absoluteItem => {
                    const key = absoluteItem.serial!.toUpperCase().replace(/ /g, '');
                    const existingItem = consolidatedMap.get(key) || {};
                    consolidatedMap.set(key, { ...existingItem, ...absoluteItem });
                });
                finalData = Array.from(consolidatedMap.values()).map(item => {
                    if (item.usuarioAtual && item.usuarioAtual.trim() !== '') {
                        return { ...item, status: 'Em Uso' };
                    }
                    return item;
                });
            } else if (baseFile) {
                finalData = baseData.map(item => {
                    if (item.usuarioAtual && item.usuarioAtual.trim() !== '') {
                        return { ...item, status: 'Em Uso' };
                    }
                    return item;
                });
            } else if (absoluteFile) {
                finalData = absoluteData.map(item => {
                    if (item.usuarioAtual && item.usuarioAtual.trim() !== '') {
                        return { ...item, status: 'Em Uso' };
                    }
                    return item;
                });
            }
            
            setConsolidatedData(finalData);

        } catch (e: any) {
            setError(`Falha ao processar arquivos: ${e.message}`);
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSaveToSystem = async () => {
        if (consolidatedData.length === 0) return;
        
        let confirmMessage = `ATENÇÃO: Esta ação substituirá TODO o inventário de equipamentos e seu histórico por ${consolidatedData.length} novos itens`;
        if (baseFile && absoluteFile) {
            confirmMessage += ` consolidados dos arquivos.`;
        } else if (baseFile) {
            confirmMessage += ` da Planilha Base.`;
        } else if (absoluteFile) {
            confirmMessage += ` do Relatório Absolute.`;
        }
        confirmMessage += ` Esta ação é irreversível. Deseja continuar?`;

        if (!window.confirm(confirmMessage)) return;
        
        setIsSaving(true);
        setError(null);
        try {
            const dataToSave = consolidatedData.map(item => ({...item, id: undefined})) as Omit<Equipment, 'id'>[];
            const result = await importEquipment(dataToSave, currentUser.username);
            if (result.success) {
                alert('Inventário consolidado e salvo com sucesso!');
                onImportSuccess();
            } else {
                setError(`Falha ao salvar no sistema: ${result.message}`);
            }
        } catch (e: any) {
            setError(`Falha ao salvar no sistema: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const filteredData = useMemo(() => {
        if (!searchTerm) return consolidatedData;
        const lowercasedFilter = searchTerm.toLowerCase();
        return consolidatedData.filter(item => {
            return Object.values(item).some(value =>
                String(value).toLowerCase().includes(lowercasedFilter)
            );
        });
    }, [searchTerm, consolidatedData]);

    const tableHeaders: (keyof Equipment)[] = [
        'equipamento', 'serial', 'usuarioAtual', 'local', 'setor', 'status', 'brand', 'model', 
        'identificador', 'nomeSO', 'memoriaFisicaTotal', 'grupoPoliticas', 'pais', 'cidade', 'estadoProvincia'
    ];

    return (
        <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
            <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                <Icon name="DatabaseZap" size={20} />
                Etapa 1: Consolidação Inicial do Inventário
            </h3>
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                Este é o primeiro passo para popular o sistema. Faça o upload da Planilha Base e/ou do Relatório Absolute para criar a base de dados inicial. Após esta etapa, esta ferramenta será desativada.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FileUploadBox
                    title="Planilha Base"
                    icon="Sheet"
                    file={baseFile}
                    onFileChange={(e) => setBaseFile(e.target.files ? e.target.files[0] : null)}
                    isLoading={isLoading || isSaving}
                />
                <FileUploadBox
                    title="Relatório Absolute"
                    icon="FileText"
                    file={absoluteFile}
                    onFileChange={(e) => setAbsoluteFile(e.target.files ? e.target.files[0] : null)}
                    isLoading={isLoading || isSaving}
                />
            </div>
            {/* Aviso de substituição de dados */}
            <p className="mt-6 text-sm text-yellow-600 dark:text-yellow-400 flex items-start gap-2">
                <Icon name="AlertTriangle" size={18} className="flex-shrink-0 mt-0.5" />
                <span>
                    Atenção: O processo de consolidação e importação substituirá <strong>TODO</strong> o inventário de equipamentos e seu histórico no sistema.
                </span>
            </p>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={handleConsolidate}
                    disabled={(!baseFile && !absoluteFile) || isLoading || isSaving}
                    className="bg-brand-primary text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold"
                    aria-label={isLoading ? 'Processando dados' : 'Consolidar dados'}
                >
                    {isLoading ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Combine" />}
                    {isLoading ? 'Processando...' : 'Consolidar Dados'}
                </button>
            </div>

            {error && <div className="mt-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert"><p>{error}</p></div>}
            
            {consolidatedData.length > 0 && !isLoading && (
                 <div className="mt-6">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary mb-4">
                        Pré-visualização ({filteredData.length} de {consolidatedData.length} itens)
                    </h3>
                     <input
                        type="text"
                        placeholder="Buscar nos resultados..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-2 mb-4 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary"
                        aria-label="Buscar na pré-visualização"
                    />
                    <div className="overflow-x-auto max-h-96 border dark:border-dark-border rounded-lg">
                        <table className="w-full text-sm text-left text-gray-700 dark:text-dark-text-secondary">
                             <thead className="text-xs text-gray-800 dark:text-dark-text-primary uppercase bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                                <tr>
                                    {tableHeaders.map(header => (
                                        <th key={header} scope="col" className="px-6 py-3 capitalize">{String(header).replace(/([A-Z])/g, ' $1')}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-dark-card">
                                {filteredData.map((item, index) => (
                                    <tr key={item.serial || item.patrimonio || index} className="border-b dark:border-dark-border last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700">
                                        {tableHeaders.map(header => (
                                            <td key={header} className="px-6 py-4 whitespace-nowrap">{item[header] || 'N/A'}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="mt-6 flex justify-end">
                        <button
                            onClick={handleSaveToSystem}
                            disabled={isSaving}
                            className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold"
                            aria-label={isSaving ? 'Salvando inventário' : 'Salvar e substituir inventário'}
                        >
                            {isSaving ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Save" />}
                            {isSaving ? 'Salvando...' : 'Salvar e Substituir Inventário'}
                        </button>
                    </div>
                 </div>
            )}
        </div>
    );
};

export default DataConsolidation;