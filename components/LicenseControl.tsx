





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
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    type="number"
                    value={draftValue}
                    onChange={(e) => setDraftValue(Number(e.target.value))}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    className="w-20 p-1 text-center bg-white dark:bg-gray-800 border border-brand-primary rounded shadow-inner"
                    min="0"
                />
                <button onClick={handleSave} className="text-green-600 hover:text-green-800"><Icon name="Check" size={18} /></button>
                <button onClick={handleCancel} className="text-red-600 hover:text-red-800"><Icon name="X" size={18} /></button>
            </div>
        );
    }

    return (
        <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
            <span className="font-bold text-lg text-brand-secondary dark:text-dark-text-primary">{value}</span>
            {!disabled && (
                <button 
                    onClick={() => setIsEditing(true)} 
                    className="text-gray-500 hover:text-brand-primary dark:hover:text-blue-400 opacity-50 hover:opacity-100 transition-opacity"
                    title="Editar total"
                >
                    <Icon name="Pencil" size={14} />
                </button>
            )}
        </span>
    );
};


const LicenseControl: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const [licenses, setLicenses] = useState<License[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [editingLicense, setEditingLicense] = useState<License | null>(null);
    const [expandedProducts, setExpandedProducts] = useState<string[]>([]);
    const [totalLicenses, setTotalLicenses] = useState<Record<string, number>>({});
    const [productNames, setProductNames] = useState<string[]>([]);

    const isAdmin = currentUser.role === UserRole.Admin;

    const handleSetTotalLicenseCount = async (productName: string, total: number) => {
        const newTotals = { ...totalLicenses, [productName]: total };
        try {
            const result = await saveLicenseTotals(newTotals, currentUser.username); // Espera a resposta JSON
            if (result.success) {
                setTotalLicenses(newTotals);
            } else {
                alert(`Falha ao salvar o total de licenças: ${result.message}. Tente novamente.`);
            }
        } catch (error: any) {
            console.error("Failed to save license totals:", error);
            alert("Falha ao salvar o total de licenças. Tente novamente. Detalhes: " + error.message);
        }
    };

    const handleSaveProductNames = async (newProductNames: string[], renames: Record<string, string>) => {
        try {
            // 1. Check for deletions and if they are allowed
            const originalProductNames = new Set(productNames);
            const currentProductNames = new Set(newProductNames);
            const deletedProductNames: string[] = [];
            originalProductNames.forEach(name => {
                if (!currentProductNames.has(name)) {
                    deletedProductNames.push(name);
                }
            });
    
            const errors: string[] = [];
            deletedProductNames.forEach(name => {
                if (licenses.some(l => l.produto === name)) {
                    errors.push(`- "${name}" não pode ser removido pois ainda existem licenças associadas a ele.`);
                }
            });
    
            if (errors.length > 0) {
                alert(`Não foi possível salvar as alterações:\n${errors.join('\n')}`);
                return;
            }
    
            // 2. Process renames in the database for existing licenses
            const renamePromises = Object.entries(renames).map(([oldName, newName]) => 
                renameProduct(oldName, newName, currentUser.username)
            );
            if (renamePromises.length > 0) {
                await Promise.all(renamePromises);
            }
    
            // 3. Construct the new totals object based on the complete new list of product names
            const newTotals: Record<string, number> = {};
            const oldTotalsWithRenamesHandled = { ...totalLicenses };
            
            // Apply renames to the old totals object before building the new one
            Object.entries(renames).forEach(([oldName, newName]) => {
                if (oldTotalsWithRenamesHandled[oldName] !== undefined) {
                    oldTotalsWithRenamesHandled[newName] = oldTotalsWithRenamesHandled[oldName];
                    delete oldTotalsWithRenamesHandled[oldName];
                }
            });
    
            // Build the new totals object from the final list of names
            newProductNames.forEach(name => {
                // Preserve existing count or default to 0 for new products
                newTotals[name] = oldTotalsWithRenamesHandled[name] ?? 0;
            });
    
            // 4. Save the complete new totals object to the database
            const result = await saveLicenseTotals(newTotals, currentUser.username);
            if (result.success) {
                alert('Nomes de produtos e totais atualizados com sucesso.');
            } else {
                alert(`Erro ao salvar alterações: ${result.message}`);
            }
    
        } catch (error: any) {
            console.error("Failed to save product name changes:", error);
            alert(`Erro ao salvar alterações: ${error.message}`);
        } finally {
            // 5. Reload all data from server to ensure consistency
            loadLicensesAndProducts();
        }
    };

    const loadLicensesAndProducts = async () => {
        setLoading(true);
        try {
            const [data, savedTotals] = await Promise.all([
                getLicenses(currentUser),
                getLicenseTotals()
            ]);
            
            setLicenses(data);
            setTotalLicenses(savedTotals);

            // Rebuild product name list from scratch using only server data
            const currentProductNames = new Set<string>();
            data.forEach(l => currentProductNames.add(l.produto));
            Object.keys(savedTotals).forEach(p => currentProductNames.add(p));

            const sortedProductNames = [...currentProductNames].sort();
            setProductNames(sortedProductNames);
            localStorage.setItem('productNames', JSON.stringify(sortedProductNames));
        } catch (error) {
            console.error("Failed to load licenses", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLicensesAndProducts();
    }, [currentUser]);

    const handleOpenModal = (license: License | null = null) => {
        setEditingLicense(license);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setEditingLicense(null);
        setIsModalOpen(false);
    };

    const handleSave = () => {
        loadLicensesAndProducts();
        handleCloseModal();
    };

    const handleDelete = async (licenseId: number) => {
        if (!isAdmin) return;
        if (window.confirm("Tem certeza que deseja excluir esta licença?")) {
            try {
                await deleteLicense(licenseId, currentUser.username);
                loadLicensesAndProducts();
            } catch (error) {
                console.error("Failed to delete license", error);
            }
        }
    };

    const filteredLicenses = useMemo(() => {
        return licenses.filter(license =>
            license.produto.toLowerCase().includes(searchTerm.toLowerCase()) ||
            license.usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
            license.chaveSerial.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [searchTerm, licenses]);

    const groupedLicenses = useMemo(() => {
      return filteredLicenses.reduce((acc, license) => {
        const product = license.produto;
        if (!acc[product]) {
          acc[product] = [];
        }
        acc[product].push(license);
        return acc;
      }, {} as Record<string, License[]>);
    }, [filteredLicenses]);

    const toggleProductExpansion = (productName: string) => {
        setExpandedProducts(prev => 
            prev.includes(productName)
            ? prev.filter(p => p !== productName)
            : [...prev, productName]
        );
    };

    {/* FIX: Replaced fragile date parsing with a more robust `parseDateString` function and updated related helpers to ensure type safety. */}
    const parseDateString = (dateStr: string | undefined): Date | null => {
        if (!dateStr || typeof dateStr !== 'string') return null;
        let date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
        const parts = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
        if (parts) {
            date = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
            if (!isNaN(date.getTime())) return date;
        }
        return null;
    };

    const isExpiringSoon = (dateStr: string) => { 
        const expDate = parseDateString(dateStr);
        if (!expDate) return false;
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        return expDate > today && expDate <= thirtyDaysFromNow;
    }
    
     const isExpired = (dateStr: string) => { 
        const expDate = parseDateString(dateStr);
        if (!expDate) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expDate < today;
    }

    const ExpirationStatus: React.FC<{dateStr?: string}> = ({dateStr}) => {
        if (!dateStr || dateStr.toUpperCase() === 'N/A') return <span>Perpétua</span>;
        
        const stringDate: string = dateStr;

        const date = parseDateString(stringDate);
        if (!date) return <span className="font-semibold flex items-center gap-1.5 text-red-500"><Icon name="TriangleAlert" size={16} /> Data Inválida</span>;
        
        const expiring = isExpiringSoon(stringDate);
        const expired = isExpired(stringDate);
        const color = expired ? 'text-red-500 dark:text-red-400' : expiring ? 'text-yellow-500 dark:text-yellow-400' : '';
        const icon = expired ? 'TriangleAlert' : expiring ? 'Timer' : null;
        return (
            <span className={`font-semibold flex items-center gap-1.5 ${color}`}>
                {icon && <Icon name={icon as any} size={16} />}
                {date.toLocaleDateString()}
            </span>
        )
    }

    const StatusIndicator: React.FC<{license: License}> = ({license}) => {
        if (license.approval_status === 'pending_approval') {
            return <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2.5 py-0.5 rounded-full">Pendente</span>
        }
        if (license.approval_status === 'rejected') {
            return (
                 <span className="text-xs font-semibold bg-red-200 text-red-800 px-2.5 py-0.5 rounded-full" title={license.rejection_reason}>
                    Rejeitado
                </span>
            )
        }
        return null;
    }

    const ActionButtons: React.FC<{license: License}> = ({license}) => (
        <div className="flex items-center gap-3">
            <button onClick={() => handleOpenModal(license)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" title="Editar"><Icon name="Pencil" size={16} /></button>
            <button onClick={() => handleDelete(license.id)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" title="Excluir"><Icon name="Trash2" size={16} /></button>
        </div>
    );

    return (
         <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary">Controle de Licenças</h2>
                <div className="flex flex-wrap gap-2">
                    {isAdmin && (
                         <button onClick={() => setIsProductModalOpen(true)} className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2">
                            <Icon name="List" size={18}/> Gerenciar Produtos
                        </button>
                    )}
                    <button onClick={() => handleOpenModal()} className="bg-brand-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                        <Icon name="CirclePlus" size={18}/> Nova Licença
                    </button>
                </div>
            </div>

            <div className="mb-4">
                 <input
                    type="text"
                    placeholder="Buscar por Produto, Usuário, Chave..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary"
                />
            </div>
            
            {loading ? (
                <div className="flex justify-center items-center py-10">
                    <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
                </div>
            ) : (
                <div className="space-y-4">
                    {Object.keys(groupedLicenses).sort().map(productName => {
                        const licensesInGroup = groupedLicenses[productName];
                        const isExpanded = expandedProducts.includes(productName);
                        const usedCount = licensesInGroup.filter(l => l.approval_status !== 'rejected').length;
                        const totalCount = totalLicenses[productName] || 0;
                        const availableCount = totalCount - usedCount;
                        const pendingCount = licensesInGroup.filter(l => l.approval_status === 'pending_approval').length;
                        
                        return (
                            <div key={productName} className="border dark:border-dark-border rounded-lg overflow-hidden transition-all duration-300 animate-fade-in-up">
                                <header 
                                    className="bg-gray-50 dark:bg-dark-bg p-4 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                                    onClick={() => toggleProductExpansion(productName)}
                                    aria-expanded={isExpanded}
                                    aria-controls={`licenses-${productName.replace(/\s+/g, '-')}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Icon name="Layers" size={24} className="text-brand-secondary dark:text-dark-text-secondary" />
                                        <h3 className="font-bold text-lg text-brand-dark dark:text-dark-text-primary">{productName}</h3>
                                         {pendingCount > 0 && (
                                            <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2.5 py-0.5 rounded-full">{pendingCount} Pendente(s)</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <div className="hidden lg:flex items-center gap-4 text-sm font-medium">
                                            <span title="Total de licenças contratadas" className="flex items-center gap-1.5 text-gray-600 dark:text-dark-text-secondary">
                                                Total:
                                                <EditableTotal productName={productName} value={totalCount} onSave={handleSetTotalLicenseCount} disabled={!isAdmin} />
                                            </span>
                                            <span title="Licenças registradas no sistema" className="flex items-center gap-1.5 text-gray-600 dark:text-dark-text-secondary">
                                                Usadas:
                                                <span className="bg-brand-secondary dark:bg-dark-border text-white dark:text-dark-text-primary text-sm font-semibold px-2.5 py-0.5 rounded-full">{usedCount}</span>
                                            </span>
                                            <span title="Licenças disponíveis para uso" className={`flex items-center gap-1.5 ${availableCount < 0 ? 'text-red-500' : availableCount === 0 ? 'text-yellow-500' : 'text-green-600'}`}>
                                                Disponíveis:
                                                <span className="font-bold text-lg">{availableCount}</span>
                                            </span>
                                        </div>
                                        <Icon name={isExpanded ? "ChevronDown" : "ChevronRight"} size={24} className="text-gray-500 dark:text-dark-text-secondary transition-transform" />
                                    </div>
                                </header>

                                {isExpanded && (
                                    <section id={`licenses-${productName.replace(/\s+/g, '-')}`} className="overflow-x-auto animate-fade-in">
                                        <table className="w-full text-sm text-left text-gray-700 dark:text-dark-text-secondary">
                                            <thead className="text-xs text-gray-800 dark:text-dark-text-primary uppercase bg-gray-100 dark:bg-gray-900/50">
                                                <tr>
                                                    <th scope="col" className="px-6 py-3">Usuário</th>
                                                    <th scope="col" className="px-6 py-3">Chave/Serial</th>
                                                    <th scope="col" className="px-6 py-3">Expiração</th>
                                                    <th scope="col" className="px-6 py-3">Status</th>
                                                    {isAdmin && <th scope="col" className="px-6 py-3 text-right">Ações</th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {licensesInGroup.map(license => (
                                                    <tr key={license.id} className={`border-b dark:border-dark-border last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 ${license.approval_status === 'pending_approval' ? 'bg-yellow-50 dark:bg-yellow-900/20' : license.approval_status === 'rejected' ? 'bg-red-50 dark:bg-red-900/20 opacity-70' : 'bg-white dark:bg-dark-card'}`}>
                                                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-dark-text-primary">{license.usuario}</td>
                                                        <td className="px-6 py-4 font-mono text-xs">{license.chaveSerial}</td>
                                                        <td className="px-6 py-4">
                                                            <ExpirationStatus dateStr={license.dataExpiracao}/>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                          <StatusIndicator license={license} />
                                                        </td>
                                                        {isAdmin && (
                                                            <td className="px-6 py-4 flex justify-end">
                                                                <ActionButtons license={license} />
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </section>
                                )}
                            </div>
                        );
                    })}

                    {Object.keys(groupedLicenses).length === 0 && !loading && (
                        <div className="text-center py-10 text-gray-500 dark:text-dark-text-secondary">
                            <Icon name="SearchX" size={48} className="mx-auto text-gray-400 mb-4" />
                            <p>Nenhuma licença encontrada.</p>
                        </div>
                    )}
                </div>
            )}

            {isModalOpen && <LicenseFormModal license={editingLicense} productNames={productNames} onClose={handleCloseModal} onSave={handleSave} currentUser={currentUser} />}
            {isProductModalOpen && isAdmin && <ProductManagementModal initialProductNames={productNames} onClose={() => setIsProductModalOpen(false)} onSave={handleSaveProductNames} />}
        </div>
    );
};

export default LicenseControl;