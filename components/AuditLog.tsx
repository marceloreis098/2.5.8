import React, { useState, useEffect } from 'react';
import { getAuditLog } from '../services/apiService';
import { AuditLogEntry } from '../types';
import Icon from './common/Icon';
import { icons } from 'lucide-react';

const AuditLog: React.FC = () => {
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filterUser, setFilterUser] = useState('');
    const [filterAction, setFilterAction] = useState('');

    useEffect(() => {
        const fetchLogs = async () => {
            setLoading(true);
            setError('');
            try {
                const data = await getAuditLog();
                setLogs(data);
            } catch (err: any) {
                setError('Falha ao carregar os registros de auditoria.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => {
        const userMatch = filterUser ? log.username.toLowerCase().includes(filterUser.toLowerCase()) : true;
        const actionMatch = filterAction ? log.action_type === filterAction : true;
        return userMatch && actionMatch;
    });
    
    const uniqueUsers = [...new Set(logs.map(log => log.username))];

    // FIX: Use the imported `icons` object directly instead of Icon.icons
    const getIconForType = (type: AuditLogEntry['target_type']): keyof typeof icons => {
        switch(type) {
            case 'EQUIPMENT': return 'Computer';
            case 'LICENSE': return 'ScrollText';
            case 'USER': return 'User';
// FIX: Corrected icon name from 'FileQuestion' to 'FileQuestionMark' as suggested by the type error.
            default: return 'FileQuestionMark';
        }
    };

    // FIX: Use the imported `icons` object directly instead of Icon.icons
    const getActionInfo = (log: AuditLogEntry): { text: string; color: string; icon: keyof typeof icons } => {
        switch (log.action_type) {
// FIX: Corrected icon name from 'PlusCircle' to 'CirclePlus' to match a valid name used elsewhere in the app.
            case 'CREATE': return { text: 'Criação', color: 'text-green-500', icon: 'CirclePlus' };
            case 'UPDATE': return { text: 'Atualização', color: 'text-yellow-500', icon: 'Pencil' };
            case 'DELETE': return { text: 'Exclusão', color: 'text-red-500', icon: 'Trash2' };
// FIX: The icon 'HelpCircle' was causing a type error. Replaced with 'Info' as a safe alternative for unknown action types.
            default: return { text: log.action_type, color: 'text-gray-500', icon: 'Info' };
        }
    };


    return (
        <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary mb-4">Registros de Auditoria</h2>
            <p className="text-gray-600 dark:text-dark-text-secondary mb-6">
                Acompanhe todas as alterações importantes feitas no sistema.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 border dark:border-dark-border rounded-lg bg-gray-50 dark:bg-dark-bg">
                <input
                    type="text"
                    placeholder="Filtrar por usuário..."
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800"
                />
                <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800">
                    <option value="">Todas as Ações</option>
                    <option value="CREATE">Criação</option>
                    <option value="UPDATE">Atualização</option>
                    <option value="DELETE">Exclusão</option>
                </select>
                <button onClick={() => { setFilterUser(''); setFilterAction(''); }} className="bg-gray-500 text-white p-2 rounded-md hover:bg-gray-600">
                    Limpar Filtros
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-10">
                    <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
                </div>
            ) : error ? (
                <div className="text-center py-10 text-red-500">{error}</div>
            ) : (
                <div className="space-y-4">
                    {filteredLogs.map(log => {
                         const actionInfo = getActionInfo(log);
                         return (
                            <div key={log.id} className="p-4 border dark:border-dark-border rounded-lg flex flex-col sm:flex-row gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-dark-bg">
                                     <Icon name={getIconForType(log.target_type)} size={24} className="text-brand-secondary dark:text-dark-text-secondary" />
                                </div>
                                <div className="flex-grow">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <span className="font-bold text-brand-dark dark:text-dark-text-primary">{log.username}</span>
                                            <span className={`ml-2 text-sm font-semibold ${actionInfo.color} flex items-center gap-1.5`}>
                                                <Icon name={actionInfo.icon} size={14}/> {actionInfo.text}
                                            </span>
                                        </div>
                                        <span className="text-xs text-gray-500 dark:text-dark-text-secondary whitespace-nowrap">
                                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700 dark:text-dark-text-secondary mt-1">{log.details}</p>
                                </div>
                            </div>
                         )
                    })}
                     {filteredLogs.length === 0 && (
                        <div className="text-center py-10 text-gray-500 dark:text-dark-text-secondary">
                             <Icon name="SearchX" size={48} className="mx-auto text-gray-400 mb-4" />
                            <p>Nenhum registro encontrado com os filtros atuais.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AuditLog;