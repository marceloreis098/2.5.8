import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, AppSettings, License } from '../types';
import Icon from './common/Icon';
import { getSettings, saveSettings, checkApiStatus, checkDatabaseBackupStatus, backupDatabase, restoreDatabase, clearDatabase, getLicenseTotals, getLicenses } from '../services/apiService';
import DataConsolidation from './DataConsolidation';
import LicenseImport from './LicenseImport'; // Novo import

interface SettingsProps {
    currentUser: User;
    onUserUpdate: (updatedUser: User) => void;
}

const DEFAULT_ENTREGA_TEMPLATE = `
<div class="text-center mb-6">
    <h1 class="text-2xl font-bold uppercase">TERMO DE RESPONSABILIDADE</h1>
    <p class="text-md mt-2">Utilização de Equipamento de Propriedade da Empresa</p>
</div>
<div class="space-y-4">
    <p><strong>Empresa:</strong> {{EMPRESA}}</p>
    <p><strong>Colaborador(a):</strong> {{USUARIO}}</p>
</div>
<div class="mt-6 border-t pt-4">
    <h2 class="font-bold mb-2">Detalhes do Equipamento:</h2>
    <ul class="list-disc list-inside space-y-1">
        <li><strong>Equipamento:</strong> {{EQUIPAMENTO}}</li>
        <li><strong>Patrimônio:</strong> {{PATRIMONIO}}</li>
        <li><strong>Serial:</strong> {{SERIAL}}</li>
    </ul>
</div>
<div class="mt-6 text-justify space-y-3">
    <p>Declaro, para todos os fins, ter recebido da empresa {{EMPRESA}} o equipamento descrito acima, em perfeitas condições de uso e funcionamento, para meu uso exclusivo no desempenho de minhas funções profissionais.</p>
    <p>Comprometo-me a zelar pela guarda, conservação e bom uso do equipamento, utilizando-o de acordo com as políticas de segurança e normas da empresa. Estou ciente de que o equipamento é uma ferramenta de trabalho e não deve ser utilizado para fins pessoais não autorizados.</p>
    <p>Em caso de dano, perda, roubo ou qualquer outro sinistro, comunicarei imediatamente meu gestor direto e o departamento de TI. Comprometo-me a devolver o equipamento nas mesmas condições em que o recebi, ressalvado o desgaste natural pelo uso normal, quando solicitado pela empresa ou ao término do meu contrato de trabalho.</p>
</div>
<div class="mt-12 text-center">
    <p>________________________________________________</p>
    <p class="mt-1 font-semibold">{{USUARIO}}</p>
</div>
<div class="mt-8 text-center">
    <p>Local e Data: {{DATA}}</p>
</div>
`;

const DEFAULT_DEVOLUCAO_TEMPLATE = `
<div class="text-center mb-6">
    <h1 class="text-2xl font-bold uppercase">TERMO DE DEVOLUÇÃO DE EQUIPAMENTO</h1>
    <p class="text-md mt-2">Devolução de Equipamento de Propriedade da Empresa</p>
</div>
<div class="space-y-4">
    <p><strong>Empresa:</strong> {{EMPRESA}}</p>
    <p><strong>Colaborador(a):</strong> {{USUARIO}}</p>
</div>
<div class="mt-6 border-t pt-4">
    <h2 class="font-bold mb-2">Detalhes do Equipamento:</h2>
    <ul class="list-disc list-inside space-y-1">
        <li><strong>Equipamento:</strong> {{EQUIPAMENTO}}</li>
        <li><strong>Patrimônio:</strong> {{PATRIMONIO}}</li>
        <li><strong>Serial:</strong> {{SERIAL}}</li>
    </ul>
</div>
<div class="mt-6 text-justify space-y-3">
    <p>Declaro, para todos os fins, ter devolvido à empresa {{EMPRESA}} o equipamento descrito acima, que estava sob minha responsabilidade para uso profissional.</p>
    <p>O equipamento foi devolvido nas mesmas condições em que o recebi, ressalvado o desgaste natural pelo uso normal, na data de {{DATA_DEVOLUCAO}}.</p>
</div>
<div class="mt-12 text-center">
    <p>________________________________________________</p>
    <p class="mt-1 font-semibold">{{USUARIO}}</p>
</div>
<div class="mt-8 text-center">
    <p>Local e Data: {{DATA}}</p>
</div>
`;


const SettingsToggle: React.FC<{
    label: string;
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    name: string;
    description?: string;
    disabled?: boolean;
}> = ({ label, checked, onChange, name, description, disabled = false }) => (
    <div className="flex items-center justify-between py-3">
        <div>
            <label htmlFor={name} className={`font-medium text-gray-800 dark:text-dark-text-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {label}
            </label>
            {description && <p className={`text-sm text-gray-500 dark:text-dark-text-secondary mt-1 ${disabled ? 'opacity-50' : ''}`}>{description}</p>}
        </div>
        <label htmlFor={name} className={`relative inline-flex items-center cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input 
                type="checkbox" 
                id={name}
                name={name}
                checked={checked} 
                onChange={onChange}
                className="sr-only peer"
                disabled={disabled}
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-brand-primary"></div>
        </label>
    </div>
);


const Settings: React.FC<SettingsProps> = ({ currentUser }) => {
    const [settings, setSettings] = useState<Partial<AppSettings>>({
        isSsoEnabled: false,
        is2faEnabled: false,
        require2fa: false,
    });
    const [termoEntregaTemplate, setTermoEntregaTemplate] = useState('');
    const [termoDevolucaoTemplate, setTermoDevolucaoTemplate] = useState('');
    const [apiStatus, setApiStatus] = useState<{ ok: boolean; message?: string } | null>(null);
    const [hasGeminiApiKey, setHasGeminiApiKey] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCheckingGeminiKey, setIsCheckingGeminiKey] = useState(false);
    const [backupStatus, setBackupStatus] = useState<{ hasBackup: boolean; backupTimestamp?: string } | null>(null);
    const [isDatabaseActionLoading, setIsDatabaseActionLoading] = useState(false);
    const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'security' | 'database' | 'integration' | 'import' | 'termo'>('general');
    const [productNames, setProductNames] = useState<string[]>([]);


    const checkGeminiApiKeyStatus = async () => {
        setIsCheckingGeminiKey(true);
        try {
            if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setHasGeminiApiKey(hasKey);
            } else {
                setHasGeminiApiKey(true); 
                console.warn("window.aistudio.hasSelectedApiKey não está disponível. Gerenciamento de chave Gemini via UI desativado.");
            }
        } catch (error) {
            console.error("Erro ao verificar status da chave Gemini:", error);
            setHasGeminiApiKey(false);
        } finally {
            setIsCheckingGeminiKey(false);
        }
    };

    const fetchAllData = useCallback(async () => {
        setIsLoading(true);
        
        const status = await checkApiStatus();
        setApiStatus(status);

        if (currentUser.role === UserRole.Admin) {
            try {
                const [data, dbBackupStatus, totals, licenses] = await Promise.all([
                    getSettings(),
                    checkDatabaseBackupStatus(),
                    getLicenseTotals(),
                    getLicenses(currentUser)
                ]);

                setSettings({
                    ...data,
                    isSsoEnabled: data.isSsoEnabled || false,
                    is2faEnabled: data.is2faEnabled || false,
                    require2fa: data.require2fa || false,
                });
                setTermoEntregaTemplate(data.termo_entrega_template || DEFAULT_ENTREGA_TEMPLATE);
                setTermoDevolucaoTemplate(data.termo_devolucao_template || DEFAULT_DEVOLUCAO_TEMPLATE);
                setBackupStatus(dbBackupStatus);

                const productNamesFromTotals = Object.keys(totals);
                const productNamesFromLicenses = [...new Set(licenses.map(l => l.produto))];
                const allProductNames = [...new Set([...productNamesFromTotals, ...productNamesFromLicenses])].sort();
                setProductNames(allProductNames);

            } catch (error) {
                console.error("Failed to load settings data:", error);
                setBackupStatus({ hasBackup: false });
            }
        }

        await checkGeminiApiKeyStatus();

        setIsLoading(false);
    }, [currentUser]);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);
    
    const handleSettingsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: checked
        }));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setSettings(prev => ({ ...prev, [name]: value }));
    };
    
    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const finalSettings = {
                ...settings,
                termo_entrega_template: termoEntregaTemplate,
                termo_devolucao_template: termoDevolucaoTemplate,
            };
            await saveSettings(finalSettings as AppSettings, currentUser.username);
            alert("Configurações salvas com sucesso!");
        } catch (error: any) {
            alert(`Falha ao salvar configurações: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSelectGeminiApiKey = async () => {
        if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
            try {
                await window.aistudio.openSelectKey();
                await checkGeminiApiKeyStatus();
            } catch (error) {
                console.error("Erro ao abrir seletor de chave Gemini:", error);
                alert("Falha ao abrir o seletor de chave da API. Tente novamente ou verifique se você está no ambiente correto.");
            }
        } else {
            alert("O seletor de chave da API Gemini não está disponível neste ambiente. Por favor, certifique-se de que a variável de ambiente API_KEY está configurada.");
        }
    };

    const handleBackupDatabase = async () => {
        if (!window.confirm("Confirmar a criação de um backup do banco de dados?")) return;
        setIsDatabaseActionLoading(true);
        try {
            const result = await backupDatabase(currentUser.username);
            if (result.success) {
                alert(result.message);
                await fetchAllData(); // Refresh status
            } else {
                alert(`Falha ao fazer backup: ${result.message}`);
            }
        } catch (error: any) {
            alert(`Erro ao fazer backup: ${error.message}`);
        } finally {
            setIsDatabaseActionLoading(false);
        }
    };

    const handleRestoreDatabase = async () => {
        if (!window.confirm("ATENÇÃO: Restaurar o banco de dados substituirá TODOS os dados atuais com o backup mais recente. Esta ação é irreversível. Deseja continuar?")) return;
        setIsDatabaseActionLoading(true);
        try {
            const result = await restoreDatabase(currentUser.username);
            if (result.success) {
                alert(result.message + " A aplicação será recarregada para refletir as mudanças.");
                window.location.reload();
            } else {
                alert(`Falha ao restaurar: ${result.message}`);
            }
        } catch (error: any) {
            alert(`Erro ao restaurar: ${error.message}`);
        } finally {
            setIsDatabaseActionLoading(false);
        }
    };

    const handleClearDatabase = async () => {
        if (!backupStatus?.hasBackup) {
            alert("Não é possível zerar o banco de dados sem um backup prévio. Por favor, faça um backup primeiro.");
            return;
        }
        if (!window.confirm("AVISO CRÍTICO: Zerar o banco de dados APAGARÁ TODOS os dados e configurações (exceto o usuário admin padrão) e reinstalará o sistema. Esta ação é IRREVERSÍVEL e SÓ DEVE SER FEITA após confirmar que um backup válido foi realizado e está disponível. Deseja realmente continuar?")) return;
        
        setIsDatabaseActionLoading(true);
        try {
            const result = await clearDatabase(currentUser.username);
            if (result.success) {
                alert(result.message + " A aplicação será recarregada.");
                window.location.reload();
            } else {
                alert(`Falha ao zerar o banco: ${result.message}`);
            }
        } catch (error: any) {
            alert(`Erro ao zerar o banco: ${error.message}`);
        } finally {
            setIsDatabaseActionLoading(false);
        }
    };

    const handleMetadataUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (!content) return;

            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(content, "text/xml");

                const entityID = xmlDoc.querySelector("EntityDescriptor")?.getAttribute("entityID");
                const ssoUrl = xmlDoc.querySelector("SingleSignOnService")?.getAttribute("Location");
                const certificateNode = xmlDoc.querySelector("*|X509Certificate");
                const certificate = certificateNode?.textContent;
                
                const newSettings: Partial<AppSettings> = {};

                if (entityID) newSettings.ssoEntityId = entityID;
                if (ssoUrl) newSettings.ssoUrl = ssoUrl;
                if (certificate) newSettings.ssoCertificate = certificate.replace(/\s/g, '');
                
                setSettings(prev => ({ ...prev, ...newSettings }));
                
                alert('Metadados importados com sucesso! Não se esqueça de salvar as alterações.');
            } catch (error) {
                console.error("Error parsing metadata XML", error);
                alert("Falha ao analisar o arquivo XML de metadados. Verifique o formato do arquivo.");
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Clear file input
    };

    const copyToClipboard = (text: string | undefined, fieldName: string) => {
        if (text) {
            navigator.clipboard.writeText(text)
                .then(() => alert(`${fieldName} copiado para a área de transferência!`))
                .catch(() => alert('Falha ao copiar.'));
        }
    };

    const acsUrl = `http://${window.location.hostname}:3001/api/sso/callback`;
    const entityId = window.location.origin;

    const settingsTabs = [
        { id: 'general', label: 'Geral', icon: 'Settings' },
        { id: 'security', label: 'Segurança', icon: 'ShieldCheck' },
        { id: 'termo', label: 'Termos', icon: 'FileText', adminOnly: true },
        { id: 'integration', label: 'Integração Gemini', icon: 'Bot' },
        { id: 'database', label: 'Banco de Dados', icon: 'HardDrive', adminOnly: true },
        { id: 'import', label: 'Importações', icon: 'UploadCloud', adminOnly: true },
    ];

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-full">
                <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
            </div>
        );
    }
    
    return (
        <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary mb-6">Configurações</h2>

            <div className="flex border-b dark:border-dark-border mb-6 overflow-x-auto">
                {settingsTabs.map(tab => {
                    if (tab.adminOnly && currentUser.role !== UserRole.Admin) return null;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSettingsTab(tab.id as any)}
                            className={`flex items-center gap-2 px-4 py-2 -mb-px border-b-2 font-medium text-sm transition-colors duration-200 
                                ${activeSettingsTab === tab.id
                                    ? 'border-brand-primary text-brand-primary dark:text-white'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-dark-text-secondary dark:hover:text-gray-300'
                                }`}
                            aria-selected={activeSettingsTab === tab.id}
                            role="tab"
                        >
                            <Icon name={tab.icon as any} size={18} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            
            <form onSubmit={handleSaveSettings}>
                <div className="space-y-8">
                    {/* Status Box should be outside form but visually inside the flow */}
                    <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                        <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                            <Icon name="Database" size={20} />
                            Status da Conexão com o Banco de Dados
                        </h3>
                        {apiStatus === null ? (
                            <p className="text-gray-500">Verificando status...</p>
                        ) : apiStatus.ok ? (
                            <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-md text-sm flex items-center gap-2">
                                <Icon name="CheckCircle" size={18} />
                                <span>Conexão com a API estabelecida com sucesso.</span>
                            </div>
                        ) : (
                            <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-md text-sm flex items-start gap-2">
                                <Icon name="TriangleAlert" size={18} className="flex-shrink-0 mt-0.5" />
                                <span><strong>Erro:</strong> {apiStatus.message}</span>
                            </div>
                        )}
                    </div>
    
                    {activeSettingsTab === 'general' && (
                        <div className="space-y-8">
                            <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                                <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                                    <Icon name="KeyRound" size={20} />
                                    Configuração SAML SSO
                                </h3>
                                <SettingsToggle
                                    label="Habilitar Login com SAML SSO"
                                    description="Permite que os usuários façam login usando um Provedor de Identidade SAML (ex: Google Workspace, Azure AD)."
                                    name="isSsoEnabled"
                                    checked={settings.isSsoEnabled || false}
                                    onChange={handleSettingsChange}
                                />
    
                                {settings.isSsoEnabled && (
                                    <div className="mt-6 space-y-6 pt-6 border-t dark:border-dark-border animate-fade-in">
                                        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-800 dark:text-blue-200">
                                            <h4 className="font-bold mb-2 flex items-center gap-2"><Icon name="Info" size={18} /> Informações para o seu Provedor de Identidade</h4>
                                            <p className="text-sm mb-4">
                                                Copie e cole estes valores na configuração da sua aplicação SAML no seu provedor de identidade (ex: Google Workspace, Azure AD).
                                            </p>
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-300 mb-1">Entity ID (ID da Entidade)</label>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={entityId}
                                                            className="p-2 w-full border dark:border-blue-300 rounded-md bg-white dark:bg-gray-800 font-mono text-xs pr-10"
                                                        />
                                                        <button type="button" onClick={() => copyToClipboard(entityId, 'Entity ID')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-brand-primary" title="Copiar">
                                                            <Icon name="Copy" size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-300 mb-1">ACS URL (URL do Consumidor de Declaração)</label>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={acsUrl}
                                                            className="p-2 w-full border dark:border-blue-300 rounded-md bg-white dark:bg-gray-800 font-mono text-xs pr-10"
                                                        />
                                                        <button type="button" onClick={() => copyToClipboard(acsUrl, 'ACS URL')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-brand-primary" title="Copiar">
                                                            <Icon name="Copy" size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
    
                                        <div>
                                            <h4 className="font-semibold text-gray-800 dark:text-dark-text-primary">Opção 1: Upload de Metadados</h4>
                                            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1 mb-3">Faça o upload do arquivo XML de metadados do seu provedor de identidade para preencher os campos automaticamente.</p>
                                            <input type="file" accept=".xml, text/xml" onChange={handleMetadataUpload} id="metadata-upload" className="hidden" />
                                            <label htmlFor="metadata-upload" className="cursor-pointer inline-flex items-center gap-2 bg-brand-secondary text-white px-4 py-2 rounded-lg hover:bg-gray-700">
                                                <Icon name="UploadCloud" size={18} /> Carregar Arquivo XML
                                            </label>
                                        </div>
    
                                        <div className="relative flex items-center">
                                            <div className="flex-grow border-t dark:border-dark-border"></div>
                                            <span className="flex-shrink mx-4 text-gray-400 dark:text-dark-text-secondary text-sm">OU</span>
                                            <div className="flex-grow border-t dark:border-dark-border"></div>
                                        </div>
    
                                        <div>
                                            <h4 className="font-semibold text-gray-800 dark:text-dark-text-primary mb-3">Opção 2: Configuração Manual</h4>
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">URL do SSO</label>
                                                    <div className="relative">
                                                        <input type="url" name="ssoUrl" value={settings.ssoUrl || ''} onChange={handleInputChange} className="p-2 w-full border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 pr-10" placeholder="https://accounts.google.com/o/saml2/idp?idpid=..." />
                                                        <button type="button" onClick={() => copyToClipboard(settings.ssoUrl, 'URL do SSO')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-brand-primary" title="Copiar">
                                                            <Icon name="Copy" size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">ID da Entidade</label>
                                                    <div className="relative">
                                                        <input type="text" name="ssoEntityId" value={settings.ssoEntityId || ''} onChange={handleInputChange} className="p-2 w-full border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 pr-10" placeholder="https://accounts.google.com/o/saml2?idpid=..." />
                                                        <button type="button" onClick={() => copyToClipboard(settings.ssoEntityId, 'ID da Entidade')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-brand-primary" title="Copiar">
                                                            <Icon name="Copy" size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">Certificado X.509</label>
                                                    <div className="relative">
                                                        <textarea name="ssoCertificate" rows={6} value={settings.ssoCertificate || ''} onChange={handleInputChange} className="p-2 w-full border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 font-mono text-xs pr-10" placeholder="Cole o conteúdo do certificado aqui..." />
                                                        <button type="button" onClick={() => copyToClipboard(settings.ssoCertificate, 'Certificado')} className="absolute top-2 right-2 px-1 flex items-center text-gray-500 hover:text-brand-primary" title="Copiar">
                                                            <Icon name="Copy" size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
    
                    {activeSettingsTab === 'security' && (
                        <div className="space-y-8">
                            <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                                <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                                <Icon name="ShieldCheck" size={20} />
                                Autenticação de Dois Fatores (2FA)
                                </h3>
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-800 dark:text-blue-200 text-sm mb-4">
                                    Aumenta a segurança da conta ao exigir um segundo passo de verificação usando um aplicativo autenticador (ex: Google Authenticator) durante o login.
                                </div>
                                <div className="divide-y dark:divide-dark-border">
                                    <SettingsToggle
                                        label="Habilitar 2FA com App Autenticador"
                                        name="is2faEnabled"
                                        checked={settings.is2faEnabled || false}
                                        onChange={handleSettingsChange}
                                        description="Permite que os usuários configurem o 2FA em seus perfis."
                                    />
                                    <SettingsToggle
                                        label="Exigir 2FA para todos os usuários"
                                        name="require2fa"
                                        checked={settings.require2fa || false}
                                        onChange={handleSettingsChange}
                                        description="Se ativado, usuários sem 2FA serão obrigados a configurá-lo no próximo login."
                                        disabled={!settings.is2faEnabled}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSettingsTab === 'termo' && currentUser.role === UserRole.Admin && (
                        <div className="space-y-8 animate-fade-in">
                            <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                                <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                                    <Icon name="FileText" size={20} />
                                    Modelos de Termos de Responsabilidade
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                                    Personalize o conteúdo dos termos gerados pelo sistema. Use os placeholders abaixo para inserir dados dinâmicos.
                                </p>
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-800 dark:text-blue-200 text-sm mb-6">
                                    <p className="font-semibold">Placeholders disponíveis:</p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                                        {/* FIX: Corrected JSX syntax for displaying placeholder strings. The double curly braces `{{...}}` are for style objects, not for rendering strings with braces. Wrapped the strings in template literals inside single curly braces. */}
                                        <code>{`{{USUARIO}}`}</code><code>{`{{EQUIPAMENTO}}`}</code><code>{`{{SERIAL}}`}</code><code>{`{{PATRIMONIO}}`}</code>
                                        <code>{`{{EMPRESA}}`}</code><code>{`{{DATA}}`}</code><code>{`{{DATA_ENTREGA}}`}</code><code>{`{{DATA_DEVOLUCAO}}`}</code>
                                    </div>
                                </div>
                    
                                {/* Editor do Termo de Entrega */}
                                <div className="mb-6">
                                    <label className="block text-md font-semibold text-gray-800 dark:text-dark-text-primary mb-2">Modelo do Termo de Entrega</label>
                                    <textarea
                                        value={termoEntregaTemplate}
                                        onChange={(e) => setTermoEntregaTemplate(e.target.value)}
                                        rows={15}
                                        className="w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 font-mono text-xs"
                                        placeholder="Insira o texto do termo de entrega aqui..."
                                    />
                                    <button type="button" onClick={() => setTermoEntregaTemplate(DEFAULT_ENTREGA_TEMPLATE)} className="text-xs text-blue-600 hover:underline mt-2">Restaurar Padrão</button>
                                </div>
                    
                                {/* Editor do Termo de Devolução */}
                                <div>
                                    <label className="block text-md font-semibold text-gray-800 dark:text-dark-text-primary mb-2">Modelo do Termo de Devolução</label>
                                    <textarea
                                        value={termoDevolucaoTemplate}
                                        onChange={(e) => setTermoDevolucaoTemplate(e.target.value)}
                                        rows={15}
                                        className="w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 font-mono text-xs"
                                        placeholder="Insira o texto do termo de devolução aqui..."
                                    />
                                    <button type="button" onClick={() => setTermoDevolucaoTemplate(DEFAULT_DEVOLUCAO_TEMPLATE)} className="text-xs text-blue-600 hover:underline mt-2">Restaurar Padrão</button>
                                </div>
                            </div>
                        </div>
                    )}
    
                    {activeSettingsTab === 'integration' && (
                        <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                            <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                                <Icon name="Bot" size={20} />
                                Chave da API Gemini
                            </h3>
                            <p className="text-gray-600 dark:text-dark-text-secondary mb-3 text-sm">
                                A chave da API do Gemini é usada para habilitar funcionalidades de IA. Ela é fornecida pelo ambiente (<code>process.env.API_KEY</code>) e pode ser selecionada aqui se você estiver em um ambiente Google AI Studio.
                            </p>
                            {isCheckingGeminiKey ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Icon name="LoaderCircle" className="animate-spin" size={18} />
                                    <span>Verificando chave...</span>
                                </div>
                            ) : hasGeminiApiKey ? (
                                <div className="flex items-center justify-between p-3 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-md text-sm">
                                    <div className="flex items-center gap-2">
                                        <Icon name="CheckCircle" size={18} />
                                        <span>Chave da API Gemini selecionada.</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleSelectGeminiApiKey}
                                        className="text-green-800 dark:text-green-300 hover:underline flex items-center gap-1"
                                        aria-label="Alterar chave da API Gemini"
                                    >
                                        <Icon name="Pencil" size={14} />
                                        Alterar
                                    </button>
                                </div>
                            ) : (
                                <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-md text-sm flex items-start gap-2">
                                    <Icon name="TriangleAlert" size={18} className="flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="font-semibold">Nenhuma chave da API Gemini selecionada.</p>
                                        <p className="mt-1">As funcionalidades de IA podem não funcionar corretamente.</p>
                                        <button
                                            type="button"
                                            onClick={handleSelectGeminiApiKey}
                                            className="mt-2 bg-brand-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
                                            aria-label="Selecionar Chave da API Gemini"
                                        >
                                            <Icon name="Key" size={16} />
                                            Selecionar Chave da API Gemini
                                        </button>
                                    </div>
                                </div>
                            )}
                            <p className="text-xs text-gray-500 dark:text-dark-text-secondary mt-3">
                                Informações sobre faturamento: <a href="ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">ai.google.dev/gemini-api/docs/billing</a>
                            </p>
                        </div>
                    )}
    
                    {activeSettingsTab === 'database' && currentUser.role === UserRole.Admin && (
                        <div className="p-6 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                            <h3 className="text-lg font-bold text-brand-secondary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                                <Icon name="HardDrive" size={20} />
                                Gerenciamento de Banco de Dados
                            </h3>
                            <div className="mb-4 text-sm text-gray-600 dark:text-dark-text-secondary">
                                <p className="mb-2">Gerencie o banco de dados da aplicação. Recomenda-se fazer backup regularmente.</p>
                                {backupStatus?.hasBackup ? (
                                    <p className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium">
                                        <Icon name="CheckCircle" size={16} /> Último backup: {new Date(backupStatus.backupTimestamp!).toLocaleString()}
                                    </p>
                                ) : (
                                    <p className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium">
                                        <Icon name="TriangleAlert" size={16} /> Nenhum backup encontrado.
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={handleBackupDatabase}
                                    disabled={isDatabaseActionLoading}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2 text-sm"
                                    aria-label="Fazer Backup do Banco de Dados"
                                >
                                    {isDatabaseActionLoading ? <Icon name="LoaderCircle" className="animate-spin" size={16} /> : <Icon name="SaveAll" size={16} />}
                                    Fazer Backup
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRestoreDatabase}
                                    disabled={isDatabaseActionLoading || !backupStatus?.hasBackup}
                                    className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 disabled:bg-gray-400 flex items-center gap-2 text-sm"
                                    aria-label="Restaurar Banco de Dados"
                                >
                                    {isDatabaseActionLoading ? <Icon name="LoaderCircle" className="animate-spin" size={16} /> : <Icon name="RotateCw" size={16} />}
                                    Restaurar Banco
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearDatabase}
                                    disabled={isDatabaseActionLoading || !backupStatus?.hasBackup}
                                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:bg-gray-400 flex items-center gap-2 text-sm"
                                    aria-label="Zerar Banco de Dados"
                                >
                                    {isDatabaseActionLoading ? <Icon name="LoaderCircle" className="animate-spin" size={16} /> : <Icon name="Eraser" size={16} />}
                                    Zerar Banco
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {activeSettingsTab === 'import' && currentUser.role === UserRole.Admin && (
                        <div>
                            <DataConsolidation currentUser={currentUser} />
                            <LicenseImport 
                                currentUser={currentUser} 
                                productNames={productNames} 
                                onImportSuccess={fetchAllData}
                            />
                        </div>
                    )}

                    {['general', 'security', 'termo'].includes(activeSettingsTab) && currentUser.role === UserRole.Admin && (
                        <div className="flex justify-end pt-4 border-t dark:border-dark-border">
                            <button type="submit" disabled={isSaving} className="bg-brand-primary text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2">
                                <Icon name="Save" size={18} />
                                {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                            </button>
                        </div>
                    )}
                </div>
            </form>
        </div>
    );
};

export default Settings;