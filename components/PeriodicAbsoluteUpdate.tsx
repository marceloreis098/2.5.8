import React, { useState, useMemo } from 'react';
import { User, Equipment } from '../types';
import Icon from './common/Icon';
import { periodicUpdateEquipment } from '../services/apiService';

type PartialEquipment = Partial<Equipment>;

interface PeriodicAbsoluteUpdateProps {
    currentUser: User;
    onUpdateSuccess: () => void;
}

const PeriodicAbsoluteUpdate: React.FC<PeriodicAbsoluteUpdateProps> = ({ currentUser, onUpdateSuccess }) => {
    const [absoluteFile, setAbsoluteFile] = useState<File | null>(null);
    const [parsedData, setParsedData] = useState<PartialEquipment[]>([]);
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
            if (char === '"') inQuote = !inQuote;
            else if (char === separator && !inQuote) {
                result.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
    };

    const parseAbsoluteCsv = (fileText: string): PartialEquipment[] => {
        const lines = fileText.trim().split(/\r\n|\n/);
        if (lines.length < 2) throw new Error("O arquivo CSV deve conter um cabeçalho e pelo menos uma linha de dados.");

        const headerLine = lines[0].endsWith(',') ? lines[0].slice(0, -1) : lines[0];
        const header = splitCsvLine(headerLine).map(h => h.trim().toUpperCase());
        const rows = lines.slice(1);
        
        const absoluteMappings: { [key: string]: keyof Equipment } = {
            'NOMEDODISPOSITIVO': 'equipamento', 'NÚMERODESÉRIE': 'serial',
            'NOMEDOUSUÁRIOATUAL': 'usuarioAtual', 'MARCA': 'brand', 'MODELO': 'model',
            'EMAIL DO COLABORADOR': 'emailColaborador', 'IDENTIFICADOR': 'identificador', 
            'NOME DO SO': 'nomeSO', 'MEMÓRIA FÍSICA TOTAL': 'memoriaFisicaTotal', 
            'GRUPO DE POLÍTICAS': 'grupoPoliticas', 'PAÍS': 'pais', 'CIDADE': 'cidade', 
            'ESTADO/PROVÍNCIA': 'estadoProvincia'
        };

        return rows.map(row => {
            if (!row.trim()) return null;
            const values = splitCsvLine(row);
            const entry: PartialEquipment = {};

            header.forEach((colName, index) => {
                const normalizedColName = colName.replace(/[\s/]+/g, '').toUpperCase();
                const mappedKey = absoluteMappings[normalizedColName] || absoluteMappings[colName.toUpperCase()];
                if (mappedKey && index < values.length) {
                    (entry as any)[mappedKey] = values[index]?.trim() || '';
                }
            });

            if (!entry.serial || entry.serial.trim() === '') return null;
            return entry;
        }).filter((item): item is PartialEquipment => item !== null);
    };

    const handlePreview = async () => {
        if (!absoluteFile) return;
        setIsLoading(true);
        setError(null);
        setParsedData([]);
        try {
            const absoluteText = await absoluteFile.text();
            const data = parseAbsoluteCsv(absoluteText);
            setParsedData(data);
        } catch (e: any) {
            setError(`Falha ao processar arquivo: ${e.message}`);
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSaveToSystem = async () => {
        if (parsedData.length === 0) return;
        if (!window.confirm(`Esta ação irá ATUALIZAR o inventário com ${parsedData.length} itens do relatório Absolute. Equipamentos existentes serão atualizados, novos serão adicionados e nenhum será removido. Deseja continuar?`)) return;
        
        setIsSaving(true);
        setError(null);
        try {
            const dataToSave = parsedData.map(item => ({...item, id: undefined})) as Omit<Equipment, 'id'>[];
            const result = await periodicUpdateEquipment(dataToSave, currentUser.username);
            if (result.success) {
                alert('Inventário atualizado com sucesso!');
                onUpdateSuccess();
                setAbsoluteFile(null);
                setParsedData([]);
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
        if (!searchTerm) return parsedData;
        const lowercasedFilter = searchTerm.toLowerCase();
        return parsedData.filter(item => Object.values(item).some(value => String(value).toLowerCase().includes(lowercasedFilter)));
    }, [searchTerm, parsedData]);

    const tableHeaders: (keyof Equipment)[] = ['equipamento', 'serial', 'usuarioAtual', 'brand', 'model', 'grupoPoliticas'];

    return (
        <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
            <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                <Icon name="RefreshCcw" size={20} />
                Etapa 2: Atualização Periódica do Inventário
            </h3>
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                Mantenha o inventário atualizado importando o relatório mais recente do Absolute. Esta ferramenta irá mesclar os dados, atualizando itens existentes e adicionando novos, sem remover os que não constam no relatório.
            </p>
            
            <div className="max-w-md">
                <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">Arquivo CSV do Absolute</label>
                <input
                    type="file"
                    onChange={(e) => setAbsoluteFile(e.target.files ? e.target.files[0] : null)}
                    accept=".csv"
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-200 dark:file:bg-gray-700 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-300 dark:hover:file:bg-gray-600 cursor-pointer"
                    disabled={isLoading || isSaving}
                />
            </div>

            <div className="mt-6">
                <button onClick={handlePreview} disabled={!absoluteFile || isLoading || isSaving} className="bg-brand-primary text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                    {isLoading ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Eye" />}
                    {isLoading ? 'Processando...' : '1. Pré-visualizar Dados'}
                </button>
            </div>

            {error && <div className="mt-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert"><p>{error}</p></div>}
            
            {parsedData.length > 0 && !isLoading && (
                 <div className="mt-6">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary mb-4">Pré-visualização ({filteredData.length} de {parsedData.length} itens)</h3>
                    <input type="text" placeholder="Buscar nos resultados..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full p-2 mb-4 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <div className="overflow-x-auto max-h-96 border dark:border-dark-border rounded-lg">
                        <table className="w-full text-sm text-left text-gray-700 dark:text-dark-text-secondary">
                             <thead className="text-xs text-gray-800 dark:text-dark-text-primary uppercase bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                                <tr>{tableHeaders.map(header => <th key={header} scope="col" className="px-6 py-3 capitalize">{String(header).replace(/([A-Z])/g, ' $1')}</th>)}</tr>
                            </thead>
                            <tbody className="bg-white dark:bg-dark-card">
                                {filteredData.map((item, index) => (
                                    <tr key={item.serial || index} className="border-b dark:border-dark-border last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700">
                                        {tableHeaders.map(header => <td key={header} className="px-6 py-4 whitespace-nowrap">{item[header] || 'N/A'}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="mt-6 flex justify-end">
                        <button onClick={handleSaveToSystem} disabled={isSaving} className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold">
                            {isSaving ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Save" />}
                            {isSaving ? 'Salvando...' : '2. Confirmar Atualização'}
                        </button>
                    </div>
                 </div>
            )}
        </div>
    );
};

export default PeriodicAbsoluteUpdate;