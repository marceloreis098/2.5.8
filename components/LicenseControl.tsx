import React, { useState, useMemo, useEffect, useRef } from 'react';
import { getLicenses, addLicense, updateLicense, deleteLicense, renameProduct, getLicenseTotals, saveLicenseTotals } from '../services/apiService';
import { License, User, UserRole } from '../types';
import Icon from './common/Icon';

const ProductManagementModal: React.FC<{
    initialProductNames: string[];
    onClose: () => void;
    onSave: (newProductNames: string[], renames: Record<string, string>) => void;
}> = ({ initialProductNames, onClose, onSave }) => {
    const [productNames, setProductNames] = useState([...initialProductNames].sort());
    const [newProductName, setNewProductName] = useState('');
    const [editingProduct, setEditingProduct] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');
    const [renames, setRenames] = useState<Record<string, string>>({});
    const editInputRef = useRef<HTMLInputElement>(null);

     useEffect(() => {
        if (editingProduct && editInputRef.current) {
            editInputRef.current.focus();
        }
    }, [editingProduct]);

    const handleAddProduct = () => {
        const trimmedName = newProductName.trim();
        if (trimmedName && !productNames.find(p => p.toLowerCase() === trimmedName.toLowerCase())) {
            setProductNames(prev => [...prev, trimmedName].sort());
            setNewProductName('');
        }
    };

    const handleDeleteProduct = (productNameToDelete: string) => {
        if (window.confirm(`Tem certeza que deseja remover "${productNameToDelete}" da lista de produtos?`)) {
            setProductNames(prev => prev.filter(p => p !== productNameToDelete));
        }
    };

    const handleStartEditing = (productName: string) => {
        setEditingProduct(productName);
        setDraftName(productName);
    };

    const handleCancelEditing = () => {
        setEditingProduct(null);
        setDraftName('');
    };
    
    const handleConfirmEdit = () => {
        if (!editingProduct || !draftName.trim() || draftName.trim() === editingProduct) {
            handleCancelEditing();
            return;
        }
        const trimmedDraft = draftName.trim();
        
        if (productNames.find(p => p.toLowerCase() === trimmedDraft.toLowerCase() && p !== editingProduct)) {
            alert(`O produto "${trimmedDraft}" já existe.`);
            return;
        }

        setProductNames(prev => prev.map(p => p === editingProduct ? trimmedDraft : p).sort());
        setRenames(prev => ({ ...prev, [editingProduct]: trimmedDraft }));
        handleCancelEditing();
    };

    const handleSave = () => {
        onSave(productNames, renames);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
                <div className="p-6 border-b dark:border-dark-border">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Gerenciar Nomes de Produtos</h3>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <p className="text-sm text-gray-600 dark:text-dark-text-secondary">Adicione ou remova os nomes de software que aparecerão na caixa de seleção ao criar uma nova licença.</p>
                    <div className="space-y-2">
                        {productNames.map(name => (
                            <div key={name} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-dark-bg rounded">
                                {editingProduct === name ? (
                                    <div className="flex-grow flex items-center gap-2">
                                        <input
                                            ref={editInputRef}
                                            type="text"
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            onBlur={handleConfirmEdit}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleConfirmEdit();
                                                if (e.key === 'Escape') handleCancelEditing();
                                            }}
                                            className="flex-grow p-1 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800"
                                        />
                                        <button onClick={handleConfirmEdit} className="text-green-500 hover:text-green-700" title="Salvar"><Icon name="Check" size={20} /></button>
                                        <button onClick={handleCancelEditing} className="text-red-500 hover:text-red-700" title="Cancelar"><Icon name="X" size={20} /></button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="text-gray-800 dark:text-dark-text-primary">{name}</span>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => handleStartEditing(name)} className="text-blue-500 hover:text-blue-700" title={`Editar ${name}`}>
                                                <Icon name="Pencil" size={16} />
                                            </button>
                                            <button onClick={() => handleDeleteProduct(name)} className="text-red-500 hover:text-red-700" title={`Remover ${name}`}>
                                                <Icon name="Trash2" size={16} />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                         {productNames.length === 0 && <p className="text-center text-gray-500">Nenhum produto cadastrado.</p>}
                    </div>
                    <div className="pt-4 border-t dark:border-dark-border">
                         <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Adicionar novo produto</label>
                         <div className="flex gap-2 mt-1">
                            <input
                                type="text"
                                value={newProductName}
                                onChange={(e) => setNewProductName(e.target.value)}
                                placeholder="Nome do Software"
                                className="flex-grow p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800"
                            />
                            <button onClick={handleAddProduct} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">Adicionar</button>
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                    <button type="button" onClick={handleSave} className="bg-brand-primary text-white px-4 py-2 rounded hover:bg-blue-700">Salvar Alterações</button>
                </div>
            </div>
        </div>
    );
};


const LicenseFormModal: React.FC<{
    license?: License | null;
    productNames: string[];
    onClose: () => void;
    onSave: () => void;
    currentUser: User;
}> = ({ license, productNames, onClose, onSave, currentUser }) => {
    const [formData, setFormData] = useState<Omit<License, 'id' | 'approval_status' | 'rejection_reason'>>({
        produto: '',
        tipoLicenca: '',
        chaveSerial: '',
        dataExpiracao: '',
        usuario: '',
        cargo: '',
        setor: '',
        gestor: '',
        centroCusto: '',
        contaRazao: '',
        nomeComputador: '',
        numeroChamado: '',
        observacoes: ''
    });
    const [isSaving, setIsSaving] = useState(false);

     useEffect(() => {
        if (license) {
            setFormData({
                produto: license.produto,
                tipoLicenca: license.tipoLicenca || '',
                chaveSerial: license.chaveSerial,
                dataExpiracao: license.dataExpiracao || '',
                usuario: license.usuario,
                cargo: license.cargo || '',
                setor: license.setor || '',
                gestor: license.gestor || '',
                centroCusto: license.centroCusto || '',
                contaRazao: license.contaRazao || '',
                nomeComputador: license.nomeComputador || '',
                numeroChamado: license.numeroChamado || '',
                observacoes: license.observacoes || ''
            });
        }
    }, [license]);


    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            if (license) {
                await updateLicense({ ...formData, id: license.id }, currentUser.username);
            } else {
                await addLicense(formData, currentUser);
            }
             if (currentUser.role !== UserRole.Admin && !license) {
                alert("Licença adicionada com sucesso! Sua solicitação foi enviada para aprovação do administrador.");
            }
            onSave();
            onClose();
        } catch (error) {
            console.error("Failed to save license", error);
        } finally {
            setIsSaving(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
            <form onSubmit={handleSubmit} className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b dark:border-dark-border flex-shrink-0">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">{license ? 'Editar Licença' : 'Nova Licença'}</h3>
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto">
                    <div className="sm:col-span-2">
                         <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Produto</label>
                        <select name="produto" value={formData.produto} onChange={handleChange} className="w-full mt-1 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800">
                            <option value="" disabled>Selecione um produto</option>
                            {productNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </div>
                    
                    <input type="text" name="chaveSerial" placeholder="Chave/Serial" value={formData.chaveSerial} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    <input type="text" name="usuario" placeholder="Usuário Atribuído" value={formData.usuario} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="cargo" placeholder="Cargo" value={formData.cargo} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />

                    <input type="text" name="setor" placeholder="Setor" value={formData.setor} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="gestor" placeholder="Gestor" value={formData.gestor} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    <input type="text" name="centroCusto" placeholder="Centro de Custo" value={formData.centroCusto} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="contaRazao" placeholder="Conta Razão" value={formData.contaRazao} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    <input type="text" name="nomeComputador" placeholder="Nome do Computador" value={formData.nomeComputador} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="numeroChamado" placeholder="Nº do Chamado da Solicitação" value={formData.numeroChamado} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />

                    <div className="sm:col-span-2">
                         <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Data de Vencimento (deixe em branco se for perpétua)</label>
                         <input type="date" name="dataExpiracao" value={(formData.dataExpiracao || '').split('T')[0]} onChange={handleChange} className="w-full mt-1 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    </div>
                     <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Observações</label>
                        <textarea
                            name="observacoes"
                            value={formData.observacoes}
                            onChange={handleChange}
                            rows={3}
                            className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-dark-border rounded-md"
                            placeholder="Adicione qualquer informação relevante sobre a solicitação ou a licença..."
                        ></textarea>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3 flex-shrink-0">
                    <button type="button" onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                    <button type="submit" disabled={isSaving} className="bg-brand-primary text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400">
                        {isSaving ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </form>
        </div>
    );
};

const EditableTotal: React.FC<{
    productName: string;
    value: number;
    onSave: (productName: string, newValue: number) => Promise<void>;
    disabled: boolean;
}> = ({ productName, value, onSave, disabled }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraftValue(value);
    }, [value]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const handleSave = async () => {
        const newTotal = parseInt(String(draftValue), 10);
        if (!isNaN(newTotal) && newTotal >= 0) {
            await onSave(productName, newTotal);
        } else {
            setDraftValue(value); // revert on invalid input
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setDraftValue(value);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') handleCancel();
    };

    if (isEditing) {
        return (
            <div className="flex items-