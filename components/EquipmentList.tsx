import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Equipment, User, UserRole, EquipmentHistory, AppSettings } from '../types';
import Icon from './common/Icon';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import { getEquipment, getEquipmentHistory, addEquipment, updateEquipment, deleteEquipment, getSettings } from '../services/apiService';
import TermoResponsabilidade from './TermoResponsabilidade';
import PeriodicUpdate from './PeriodicUpdate'; // Importar o novo componente

const StatusBadge: React.FC<{ status: Equipment['approval_status'], reason?: string }> = ({ status, reason }) => {
    if (!status || status === 'approved') return null;

    const baseClasses = "ml-2 text-xs font-semibold px-2 py-0.5 rounded-full";
    const statusMap = {
        pending_approval: { text: 'Pendente', className: 'bg-yellow-200 text-yellow-800' },
        rejected: { text: 'Rejeitado', className: 'bg-red-200 text-red-800' },
    };

    const currentStatus = statusMap[status];
    if (!currentStatus) return null;

    return (
        <span className={`${baseClasses} ${currentStatus.className}`} title={reason || undefined}>
            {currentStatus.text}
        </span>
    );
};

const TermoStatusBadge: React.FC<{ condicao?: string }> = ({ condicao }) => {
    if (!condicao || condicao === 'N/A') {
        return <span className="text-xs text-gray-500 dark:text-dark-text-secondary">N/A</span>;
    }

    const statusMap = {
        'Pendente': { text: 'Pendente', className: 'bg-yellow-200 text-yellow-800' },
        'Assinado - Entrega': { text: 'Entregue', className: 'bg-green-200 text-green-800' },
        'Assinado - Devolução': { text: 'Devolvido', className: 'bg-blue-200 text-blue-800' },
    };

    const currentStatus = statusMap[condicao as keyof typeof statusMap];
    if (!currentStatus) return <span className="text-xs text-gray-500">{condicao}</span>;

    return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${currentStatus.className}`}>
            {currentStatus.text}
        </span>
    );
};


const EquipmentFormModal: React.FC<{
    equipment?: Equipment | null;
    onClose: () => void;
    onSave: () => void;
    currentUser: User;
}> = ({ equipment, onClose, onSave, currentUser }) => {
    const [formData, setFormData] = useState<Omit<Equipment, 'id' | 'qrCode' | 'approval_status' | 'rejection_reason'>>({
        equipamento: '', garantia: '', patrimonio: '', serial: '', usuarioAtual: '', usuarioAnterior: '',
        local: '', setor: '', dataEntregaUsuario: '', status: '', dataDevolucao: '', tipo: '',
        notaCompra: '', notaPlKm: '', termoResponsabilidade: '', foto: '',
        brand: '', model: '', observacoes: '', emailColaborador: '',
        // Novos campos
        identificador: '', nomeSO: '', memoriaFisicaTotal: '', grupoPoliticas: '',
        pais: '', cidade: '', estadoProvincia: '', condicaoTermo: 'N/A'
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (equipment) {
            const initialData: Omit<Equipment, 'id' | 'qrCode' | 'approval_status' | 'rejection_reason'> = {
                equipamento: equipment.equipamento || '',
                garantia: equipment.garantia || '',
                patrimonio: equipment.patrimonio || '',
                serial: equipment.serial || '',
                brand: equipment.brand || '',
                model: equipment.model || '',
                usuarioAtual: equipment.usuarioAtual || '',
                usuarioAnterior: equipment.usuarioAnterior || '',
                emailColaborador: equipment.emailColaborador || '',
                local: equipment.local || '',
                setor: equipment.setor || '',
                dataEntregaUsuario: equipment.dataEntregaUsuario || '',
                status: equipment.status || '',
                dataDevolucao: equipment.dataDevolucao || '',
                tipo: equipment.tipo || '',
                notaCompra: equipment.notaCompra || '',
                notaPlKm: equipment.notaPlKm || '',
                termoResponsabilidade: equipment.termoResponsabilidade || '',
                foto: equipment.foto || '',
                observacoes: equipment.observacoes || '',
                // Novos campos
                identificador: equipment.identificador || '',
                nomeSO: equipment.nomeSO || '',
                memoriaFisicaTotal: equipment.memoriaFisicaTotal || '',
                grupoPoliticas: equipment.grupoPoliticas || '',
                pais: equipment.pais || '',
                cidade: equipment.cidade || '',
                estadoProvincia: equipment.estadoProvincia || '',
                condicaoTermo: equipment.condicaoTermo || 'N/A'
            };
            setFormData(initialData);
        }
    }, [equipment]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setSaveError('Por favor, selecione um arquivo de imagem válido.');
                return;
            }
            if (file.size > 2 * 1024 * 1024) { // 2MB
                setSaveError('A imagem é muito grande. O limite é de 2MB.');
                return;
            }
            setSaveError('');
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData(prev => ({ ...prev, foto: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveError('');

        // Basic validation for required fields
        if (!formData.equipamento || !formData.serial) {
            setSaveError('Equipamento e Serial são campos obrigatórios.');
            setIsSaving(false);
            return;
        }

        try {
            if (equipment) {
                await updateEquipment({ ...formData, id: equipment.id }, currentUser.username);
            } else {
                await addEquipment(formData, currentUser);
                if (currentUser.role !== UserRole.Admin) {
                    alert("Equipamento adicionado com sucesso! Sua solicitação foi enviada para aprovação do administrador.");
                }
            }
            onSave();
            onClose();
        } catch (error: any) {
            console.error("Failed to save equipment", error);
            if (error.message.includes("Serial")) {
                 setSaveError(error.message); // Display specific serial error from API
            } else {
                setSaveError("Falha ao salvar equipamento. Tente novamente.");
            }
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
            <form onSubmit={handleSubmit} className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b dark:border-dark-border flex-shrink-0">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">{equipment ? 'Editar Equipamento' : 'Novo Equipamento'}</h3>
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto">
                    {saveError && <div className="sm:col-span-2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">{saveError}</div>}
                    
                    <input type="text" name="equipamento" placeholder="Nome do Equipamento *" value={formData.equipamento} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" required />
                    <input type="text" name="patrimonio" placeholder="Patrimônio" value={formData.patrimonio || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="serial" placeholder="Serial *" value={formData.serial || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" required />
                    <input type="text" name="brand" placeholder="Marca" value={formData.brand || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="model" placeholder="Modelo" value={formData.model || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="tipo" placeholder="Tipo (Notebook, Monitor, etc.)" value={formData.tipo || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    {/* Campos de Informação de Atribuição */}
                    <hr className="sm:col-span-2 my-2 border-t dark:border-dark-border" />
                    <label className="sm:col-span-2 text-md font-semibold text-gray-700 dark:text-dark-text-primary">Informações de Atribuição</label>
                    
                    <input type="text" name="usuarioAtual" placeholder="Usuário Atual" value={formData.usuarioAtual || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="emailColaborador" placeholder="Email do Colaborador" value={formData.emailColaborador || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="local" placeholder="Local de Uso" value={formData.local || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="setor" placeholder="Setor" value={formData.setor || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Data de Entrega ao Usuário</label>
                        <input type="date" name="dataEntregaUsuario" value={(formData.dataEntregaUsuario || '').split('T')[0]} onChange={handleChange} className="w-full mt-1 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    </div>
                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Data de Devolução</label>
                        <input type="date" name="dataDevolucao" value={(formData.dataDevolucao || '').split('T')[0]} onChange={handleChange} className="w-full mt-1 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    </div>

                    <select name="status" value={formData.status || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800">
                        <option value="">Selecione o Status</option>
                        <option value="Em Uso">Em Uso</option>
                        <option value="Estoque">Estoque</option>
                        <option value="Manutenção">Manutenção</option>
                        <option value="Descartado">Descartado</option>
                        <option value="Perdido">Perdido</option>
                        <option value="Doado">Doado</option>
                    </select>

                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Condição do Termo</label>
                        <select name="condicaoTermo" value={formData.condicaoTermo || 'N/A'} onChange={handleChange} className="w-full mt-1 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800">
                            <option value="N/A">N/A</option>
                            <option value="Pendente">Pendente</option>
                            <option value="Assinado - Entrega">Assinado - Entrega</option>
                            <option value="Assinado - Devolução">Assinado - Devolução</option>
                        </select>
                    </div>

                    {/* Outras Informações */}
                    <hr className="sm:col-span-2 my-2 border-t dark:border-dark-border" />
                    <label className="sm:col-span-2 text-md font-semibold text-gray-700 dark:text-dark-text-primary">Outras Informações</label>

                    <input type="text" name="garantia" placeholder="Garantia (Ex: 1 ano)" value={formData.garantia || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="notaCompra" placeholder="Nota de Compra" value={formData.notaCompra || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="notaPlKm" placeholder="Nota / PL K&M" value={formData.notaPlKm || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="termoResponsabilidade" placeholder="Termo de Responsabilidade" value={formData.termoResponsabilidade || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    
                    {/* Novos campos adicionados */}
                    <hr className="sm:col-span-2 my-2 border-t dark:border-dark-border" />
                    <label className="sm:col-span-2 text-md font-semibold text-gray-700 dark:text-dark-text-primary">Detalhes Técnicos e Localização</label>

                    <input type="text" name="identificador" placeholder="Identificador (UUID/GUID)" value={formData.identificador || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="nomeSO" placeholder="Nome do Sistema Operacional" value={formData.nomeSO || ''} onChange={handleChange} className="p-2 border dark:border-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="memoriaFisicaTotal" placeholder="Memória Física Total (Ex: 16 GB)" value={formData.memoriaFisicaTotal || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="grupoPoliticas" placeholder="Grupo de Políticas (Ex: AD-Users)" value={formData.grupoPoliticas || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="pais" placeholder="País" value={formData.pais || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="estadoProvincia" placeholder="Estado/Província" value={formData.estadoProvincia || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    <input type="text" name="cidade" placeholder="Cidade" value={formData.cidade || ''} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />

                    <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Observações</label>
                        <textarea
                            name="observacoes"
                            value={formData.observacoes || ''}
                            onChange={handleChange}
                            rows={3}
                            className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-dark-border rounded-md"
                            placeholder="Adicione qualquer informação relevante..."
                        ></textarea>
                    </div>

                    <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">Foto do Equipamento</label>
                        <div className="flex items-center gap-4">
                            {formData.foto && (
                                <img src={formData.foto} alt="Preview" className="w-24 h-24 object-cover rounded-md border dark:border-dark-border" />
                            )}
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handlePhotoChange}
                                accept="image/png, image/jpeg"
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand-primary file:text-white hover:file:bg-blue-700 cursor-pointer dark:file:bg-brand-primary dark:file:text-white"
                            />
                        </div>
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

const EquipmentDetailModal: React.FC<{
    equipment: Equipment;
    onClose: () => void;
    onEdit: (equipment: Equipment) => void;
    onDelete: (id: number) => void;
    onEntregar: (equipment: Equipment) => void;
    onDevolver: (equipment: Equipment) => void;
    currentUser: User;
}> = ({ equipment, onClose, onEdit, onDelete, onEntregar, onDevolver, currentUser }) => {
    const isAdminOrUserManager = currentUser.role === UserRole.Admin || currentUser.role === UserRole.UserManager;
    const isOwner = currentUser.id === equipment.created_by_id;

    const canEdit = (isAdminOrUserManager && equipment.approval_status !== 'rejected') || (isOwner && equipment.approval_status === 'pending_approval');
    const canDelete = isAdminOrUserManager || (isOwner && equipment.approval_status === 'pending_approval');
    const canManage = isAdminOrUserManager; // Only admins/managers can deliver or return

    const QRCodeComponent: React.FC<{ value: string }> = ({ value }) => {
        const [isLoaded, setIsLoaded] = useState(false);
        useEffect(() => setIsLoaded(true), []); // Ensure it loads only on client-side

        if (!isLoaded) return null; // Avoid server-side rendering issues
        return <QRCode value={value} size={128} level="H" includeMargin={true} />;
    };

    const StatusBadgeDetail: React.FC<{ status: Equipment['approval_status'], reason?: string }> = ({ status, reason }) => {
        if (!status || status === 'approved') return null;

        const baseClasses = "text-sm font-semibold px-2 py-1 rounded-full flex items-center gap-1";
        const statusMap = {
            pending_approval: { text: 'Pendente de Aprovação', className: 'bg-yellow-200 text-yellow-800', icon: 'Hourglass' },
            rejected: { text: 'Rejeitado', className: 'bg-red-200 text-red-800', icon: 'Ban' },
        };

        const currentStatus = statusMap[status];
        if (!currentStatus) return null;

        return (
            <span className={`${baseClasses} ${currentStatus.className}`} title={reason || undefined}>
                <Icon name={currentStatus.icon as any} size={16} /> {currentStatus.text}
            </span>
        );
    };


    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b dark:border-dark-border flex justify-between items-center flex-shrink-0">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Detalhes do Equipamento</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">
                        <Icon name="X" size={24} />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto text-gray-700 dark:text-dark-text-secondary">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-6">
                        {equipment.foto && (
                            <div className="md:col-span-2 mb-4 flex justify-center">
                                <img src={equipment.foto} alt={equipment.equipamento} className="max-h-64 object-contain rounded-lg shadow-md border dark:border-dark-border" />
                            </div>
                        )}
                        <div className="md:col-span-2 mb-2">
                             <h4 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary mb-1">{equipment.equipamento}</h4>
                             <p className="text-brand-primary text-lg font-semibold">{equipment.brand} {equipment.model}</p>
                             <StatusBadgeDetail status={equipment.approval_status} reason={equipment.rejection_reason} />
                        </div>

                        <div><strong>Patrimônio:</strong> {equipment.patrimonio || 'N/A'}</div>
                        <div><strong>Serial:</strong> {equipment.serial || 'N/A'}</div>
                        <div><strong>Tipo:</strong> {equipment.tipo || 'N/A'}</div>
                        <div><strong>Garantia:</strong> {equipment.garantia || 'N/A'}</div>
                        <div><strong>Status:</strong> {equipment.status || 'N/A'}</div>
                        
                        <div className="md:col-span-2 border-t dark:border-dark-border pt-4 mt-4">
                            <h5 className="font-semibold text-brand-dark dark:text-dark-text-primary mb-2">Atribuição:</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                                <div><strong>Usuário Atual:</strong> {equipment.usuarioAtual || 'N/A'}</div>
                                <div><strong>Email Colaborador:</strong> {equipment.emailColaborador || 'N/A'}</div>
                                <div><strong>Local:</strong> {equipment.local || 'N/A'}</div>
                                <div><strong>Setor:</strong> {equipment.setor || 'N/A'}</div>
                                <div><strong>Data Entrega:</strong> {equipment.dataEntregaUsuario || 'N/A'}</div>
                                <div><strong>Data Devolução:</strong> {equipment.dataDevolucao || 'N/A'}</div>
                                <div className="sm:col-span-2"><strong>Condição do Termo:</strong> <TermoStatusBadge condicao={equipment.condicaoTermo} /></div>
                            </div>
                        </div>

                        <div className="md:col-span-2 border-t dark:border-dark-border pt-4 mt-4">
                            <h5 className="font-semibold text-brand-dark dark:text-dark-text-primary mb-2">Detalhes Técnicos:</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                                <div><strong>Identificador:</strong> {equipment.identificador || 'N/A'}</div>
                                <div><strong>Sistema Operacional:</strong> {equipment.nomeSO || 'N/A'}</div>
                                <div><strong>Memória Física Total:</strong> {equipment.memoriaFisicaTotal || 'N/A'}</div>
                                <div><strong>Grupo de Políticas:</strong> {equipment.grupoPoliticas || 'N/A'}</div>
                                <div><strong>País:</strong> {equipment.pais || 'N/A'}</div>
                                <div><strong>Estado/Província:</strong> {equipment.estadoProvincia || 'N/A'}</div>
                                <div><strong>Cidade:</strong> {equipment.cidade || 'N/A'}</div>
                            </div>
                        </div>

                        <div className="md:col-span-2 border-t dark:border-dark-border pt-4 mt-4">
                            <h5 className="font-semibold text-brand-dark dark:text-dark-text-primary mb-2">Documentos e Notas:</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                                <div><strong>Nota Compra:</strong> {equipment.notaCompra || 'N/A'}</div>
                                <div><strong>Nota PL K&M:</strong> {equipment.notaPlKm || 'N/A'}</div>
                                <div><strong>Termo de Responsabilidade:</strong> {equipment.termoResponsabilidade || 'N/A'}</div>
                            </div>
                        </div>

                        {equipment.observacoes && (
                            <div className="md:col-span-2 border-t dark:border-dark-border pt-4 mt-4">
                                <h5 className="font-semibold text-brand-dark dark:text-dark-text-primary mb-2">Observações:</h5>
                                <p className="whitespace-pre-wrap">{equipment.observacoes}</p>
                            </div>
                        )}

                        {equipment.qrCode && (
                            <div className="md:col-span-2 border-t dark:border-dark-border pt-4 mt-4 flex justify-center">
                                <div className="text-center">
                                    <p className="font-semibold text-brand-dark dark:text-dark-text-primary mb-2">Código QR:</p>
                                    <QRCodeComponent value={equipment.qrCode} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end flex-wrap gap-3 flex-shrink-0">
                    {canManage && equipment.status === 'Estoque' && (
                         <button onClick={() => onEntregar(equipment)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2">
                            <Icon name="UserCheck" size={16} /> Entregar para Usuário
                        </button>
                    )}
                     {canManage && equipment.status === 'Em Uso' && (
                         <button onClick={() => onDevolver(equipment)} className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 flex items-center gap-2">
                            <Icon name="Undo2" size={16} /> Devolução de Equipamento
                        </button>
                    )}
                    {canEdit && (
                        <button onClick={() => onEdit(equipment)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                            <Icon name="Pencil" size={16} /> Editar
                        </button>
                    )}
                    {canDelete && (
                        <button onClick={() => onDelete(equipment.id)} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2">
                            <Icon name="Trash2" size={16} /> Excluir
                        </button>
                    )}
                    <button onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">Fechar</button>
                </div>
            </div>
        </div>
    );
};

const EquipmentHistoryModal: React.FC<{ equipmentId: number; onClose: () => void }> = ({ equipmentId, onClose }) => {
    const [history, setHistory] = useState<EquipmentHistory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchHistory = async () => {
            setLoading(true);
            try {
                const data = await getEquipmentHistory(equipmentId);
                setHistory(data);
            } catch (err: any) {
                setError('Falha ao carregar o histórico do equipamento.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchHistory();
    }, [equipmentId]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b dark:border-dark-border flex justify-between items-center flex-shrink-0">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Histórico do Equipamento</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">
                        <Icon name="X" size={24} />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto text-gray-700 dark:text-dark-text-secondary">
                    {loading ? (
                        <div className="flex justify-center items-center py-10">
                            <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
                        </div>
                    ) : error ? (
                        <div className="text-center py-10 text-red-500">{error}</div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">Nenhum histórico encontrado para este equipamento.</div>
                    ) : (
                        <div className="space-y-4">
                            {history.map((entry) => (
                                <div key={entry.id} className="p-3 bg-gray-50 dark:bg-dark-bg rounded-lg border dark:border-dark-border">
                                    <p className="text-sm font-semibold text-brand-dark dark:text-dark-text-primary">{new Date(entry.timestamp).toLocaleString()}</p>
                                    <p className="text-xs text-gray-600 dark:text-dark-text-secondary">Por: {entry.changedBy}</p>
                                    <p className="text-sm mt-1">
                                        Campo: <strong className="capitalize">{entry.changeType.replace(/([A-Z])/g, ' $1')}</strong> mudou de "{entry.from_value || 'N/A'}" para "{entry.to_value || 'N/A'}"
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end flex-shrink-0">
                    <button onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">Fechar</button>
                </div>
            </div>
        </div>
    );
};


interface EquipmentListProps {
    currentUser: User;
    companyName: string;
}

const EquipmentList: React.FC<EquipmentListProps> = ({ currentUser, companyName }) => {
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
    const [viewingEquipment, setViewingEquipment] = useState<Equipment | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [filterType, setFilterType] = useState<string>('');
    const [filterGrupoPoliticas, setFilterGrupoPoliticas] = useState<string>('');
    const [termoData, setTermoData] = useState<{ equipment: Equipment, type: 'entrega' | 'devolucao' } | null>(null);
    const [entregaEquipment, setEntregaEquipment] = useState<Equipment | null>(null);
    const [devolucaoEquipment, setDevolucaoEquipment] = useState<Equipment | null>(null);
    const [settings, setSettings] = useState<Partial<AppSettings>>({});
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);


    const loadData = async () => {
        setLoading(true);
        try {
            const [data, settingsData] = await Promise.all([
                getEquipment(currentUser),
                getSettings()
            ]);
            setEquipment(data);
            setSettings(settingsData);
        } catch (error) {
            console.error("Failed to load data", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [currentUser]);

    const handleOpenFormModal = (item: Equipment | null = null) => {
        setEditingEquipment(item);
        setIsFormModalOpen(true);
    };

    const handleCloseFormModal = () => {
        setEditingEquipment(null);
        setIsFormModalOpen(false);
    };

    const handleOpenDetailModal = (item: Equipment) => {
        setViewingEquipment(item);
        setIsDetailModalOpen(true);
    };

    const handleCloseDetailModal = () => {
        setViewingEquipment(null);
        setIsDetailModalOpen(false);
    };

    const handleOpenHistoryModal = (equipmentId: number) => {
        setViewingEquipment(equipment.find(eq => eq.id === equipmentId) || null);
        setIsHistoryModalOpen(true);
    };

    const handleCloseHistoryModal = () => {
        setViewingEquipment(null);
        setIsHistoryModalOpen(false);
    };
    
    const handleOpenEntregaModal = (item: Equipment) => {
        setEntregaEquipment(item);
        handleCloseDetailModal();
    };

    const handleOpenDevolucaoModal = (item: Equipment) => {
        setDevolucaoEquipment(item);
        handleCloseDetailModal();
    };

    const handleSaveEntrega = async (equipment: Equipment, newUserData: { usuarioAtual: string, emailColaborador: string }) => {
        const updatedEquipment = {
            ...equipment,
            ...newUserData,
            status: 'Em Uso',
            dataEntregaUsuario: new Date().toISOString().split('T')[0],
            dataDevolucao: '', // Clear return date
            condicaoTermo: 'Assinado - Entrega' as const,
        };

        try {
            await updateEquipment(updatedEquipment, currentUser.username);
            loadData();
            setEntregaEquipment(null);
            setTermoData({ equipment: updatedEquipment, type: 'entrega' });
        } catch (error) {
            console.error("Failed to deliver equipment", error);
            alert("Falha ao entregar equipamento.");
        }
    };

    const handleConfirmDevolucao = async (equipment: Equipment) => {
        const updatedEquipment = {
            ...equipment,
            usuarioAnterior: equipment.usuarioAtual,
            usuarioAtual: '',
            emailColaborador: '',
            status: 'Estoque',
            dataDevolucao: new Date().toISOString().split('T')[0],
            condicaoTermo: 'Assinado - Devolução' as const,
        };

        try {
            await updateEquipment(updatedEquipment, currentUser.username);
            loadData();
            setDevolucaoEquipment(null);
            setTermoData({ equipment: updatedEquipment, type: 'devolucao' });
        } catch (error) {
            console.error("Failed to return equipment", error);
            alert("Falha ao devolver equipamento.");
        }
    };


    const handleSave = () => {
        loadData();
        handleCloseFormModal();
        handleCloseDetailModal(); // Close detail if opened from it
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm("Tem certeza que deseja excluir este equipamento?")) return;
        try {
            await deleteEquipment(id, currentUser.username);
            loadData();
            handleCloseDetailModal(); // Close detail after deleting
        } catch (error) {
            console.error("Failed to delete equipment", error);
        }
    };

    const handleCloseTermo = () => {
        setTermoData(null);
    };

    const handleUpdateSuccess = () => {
        loadData();
        setIsUpdateModalOpen(false);
        alert("Atualização periódica concluída com sucesso!");
    };


    const filteredEquipment = useMemo(() => {
        return equipment.filter(item => {
            const matchesSearch = searchTerm ?
                Object.values(item).some(value =>
                    String(value).toLowerCase().includes(searchTerm.toLowerCase())
                ) : true;

            const matchesStatus = filterStatus ? item.status === filterStatus : true;
            const matchesType = filterType ? item.tipo === filterType : true;
            const matchesGrupoPoliticas = filterGrupoPoliticas ? item.grupoPoliticas === filterGrupoPoliticas : true;

            return matchesSearch && matchesStatus && matchesType && matchesGrupoPoliticas;
        });
    }, [searchTerm, equipment, filterStatus, filterType, filterGrupoPoliticas]);

    const handleExportToXlsx = async () => {
        try {
            if (filteredEquipment.length === 0) {
                alert("Nenhum dado para exportar com os filtros atuais.");
                return;
            }
    
            // Dynamically import the library and use the resolved module directly.
            const importedModule = await import('xlsx');
            
            // Handle potential CJS/ESM module differences.
            const XLSX = importedModule.default || importedModule;
    
            if (!XLSX || !XLSX.utils || typeof XLSX.utils.json_to_sheet !== 'function') {
                console.error("A biblioteca XLSX não foi carregada corretamente ou tem uma estrutura inesperada.", { importedModule });
                alert("Ocorreu um erro ao carregar a biblioteca de exportação. Verifique o console para mais detalhes.");
                return;
            }
    
            const headerMapping: { [K in keyof Equipment]?: string } = {
                equipamento: 'Equipamento', patrimonio: 'Patrimônio', serial: 'Serial', brand: 'Marca',
                model: 'Modelo', tipo: 'Tipo', status: 'Status', usuarioAtual: 'Usuário Atual',
                emailColaborador: 'Email do Colaborador', local: 'Local', setor: 'Setor',
                dataEntregaUsuario: 'Data de Entrega', dataDevolucao: 'Data de Devolução',
                condicaoTermo: 'Condição do Termo', garantia: 'Garantia', notaCompra: 'Nota de Compra',
                identificador: 'Identificador', nomeSO: 'Sistema Operacional',
                memoriaFisicaTotal: 'Memória Física', grupoPoliticas: 'Grupo de Políticas',
                pais: 'País', estadoProvincia: 'Estado/Província', cidade: 'Cidade', observacoes: 'Observações'
            };
    
            const dataKeys = Object.keys(headerMapping) as (keyof Equipment)[];
    
            const dataToExport = filteredEquipment.map(item => {
                const row: { [key: string]: any } = {};
                dataKeys.forEach(key => {
                    const header = headerMapping[key];
                    if (header) {
                        row[header] = item[key] ?? '';
                    }
                });
                return row;
            });
    
            const ws = XLSX.utils.json_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Inventário");
    
            const fileName = `inventario_equipamentos_${new Date().toISOString().split('T')[0]}.xlsx`;
            XLSX.writeFile(wb, fileName);
        } catch (error) {
            console.error("Erro ao exportar para XLSX:", error);
            alert("Ocorreu um erro inesperado ao tentar exportar a planilha. Verifique o console do navegador para mais detalhes.");
        }
    };


    const uniqueStatuses = useMemo(() => {
        const statuses = new Set(equipment.map(item => item.status).filter(Boolean) as string[]);
        return ['', ...Array.from(statuses)].sort();
    }, [equipment]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(equipment.map(item => item.tipo).filter(Boolean) as string[]);
        return ['', ...Array.from(types)].sort();
    }, [equipment]);

    const uniqueGrupoPoliticas = useMemo(() => {
        const grupos = new Set(equipment.map(item => item.grupoPoliticas).filter(Boolean) as string[]);
        return ['', ...Array.from(grupos)].sort();
    }, [equipment]);

    const isAdmin = currentUser.role === UserRole.Admin;
    const isAdminOrUserManager = currentUser.role === UserRole.Admin || currentUser.role === UserRole.UserManager;

    const ActionButtons: React.FC<{ item: Equipment }> = ({ item }) => {
        const isOwner = currentUser.id === item.created_by_id;
        const canEdit = (isAdminOrUserManager && item.approval_status !== 'rejected') || (isOwner && item.approval_status === 'pending_approval');
        const canDelete = isAdminOrUserManager || (isOwner && item.approval_status === 'pending_approval');
        
        return (
            <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); handleOpenDetailModal(item); }} className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white" title="Ver Detalhes"><Icon name="Eye" size={16} /></button>
                <button onClick={(e) => { e.stopPropagation(); handleOpenHistoryModal(item.id); }} className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white" title="Ver Histórico"><Icon name="History" size={16} /></button>
                {canEdit && (
                    <button onClick={(e) => { e.stopPropagation(); handleOpenFormModal(item); }} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" title="Editar"><Icon name="Pencil" size={16} /></button>
                )}
                {canDelete && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" title="Excluir"><Icon name="Trash2" size={16} /></button>
                )}
            </div>
        );
    };
    
    // Delivery Modal Component
    const EntregaEquipamentoModal: React.FC<{
        equipment: Equipment;
        onClose: () => void;
        onSave: (equipment: Equipment, userData: { usuarioAtual: string, emailColaborador: string }) => void;
    }> = ({ equipment, onClose, onSave }) => {
        const [usuarioAtual, setUsuarioAtual] = useState('');
        const [emailColaborador, setEmailColaborador] = useState('');
        const [isSaving, setIsSaving] = useState(false);
    
        const handleSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            if (!usuarioAtual || !emailColaborador) {
                alert("Por favor, preencha o nome e o email do usuário.");
                return;
            }
            setIsSaving(true);
            await onSave(equipment, { usuarioAtual, emailColaborador });
            setIsSaving(false);
        };
    
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                <form onSubmit={handleSubmit} className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-md">
                    <div className="p-6 border-b dark:border-dark-border">
                        <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Entregar Equipamento</h3>
                        <p className="text-sm text-gray-500 dark:text-dark-text-secondary">{equipment.equipamento} (Serial: {equipment.serial})</p>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Nome do Usuário</label>
                            <input type="text" value={usuarioAtual} onChange={e => setUsuarioAtual(e.target.value)} className="mt-1 w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Email do Usuário</label>
                            <input type="email" value={emailColaborador} onChange={e => setEmailColaborador(e.target.value)} className="mt-1 w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" required />
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                        <button type="submit" disabled={isSaving} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400">
                            {isSaving ? 'Entregando...' : 'Confirmar Entrega'}
                        </button>
                    </div>
                </form>
            </div>
        );
    };
    
    // Return Modal Component
    const DevolucaoEquipamentoModal: React.FC<{
        equipment: Equipment;
        onClose: () => void;
        onConfirm: (equipment: Equipment) => void;
    }> = ({ equipment, onClose, onConfirm }) => {
        const [isSaving, setIsSaving] = useState(false);

        const handleConfirm = async () => {
            setIsSaving(true);
            await onConfirm(equipment);
            setIsSaving(false);
        };
        
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-md">
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Devolver Equipamento</h3>
                        <p className="mt-2 text-gray-600 dark:text-dark-text-secondary">
                            Você confirma a devolução do equipamento <strong className="text-brand-secondary dark:text-dark-text-primary">{equipment.equipamento}</strong> (Serial: {equipment.serial}) que está atualmente com <strong className="text-brand-secondary dark:text-dark-text-primary">{equipment.usuarioAtual}</strong>?
                        </p>
                        <p className="mt-2 text-sm text-gray-500">O status será alterado para "Estoque" e um termo de devolução será gerado.</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                        <button onClick={handleConfirm} disabled={isSaving} className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 disabled:bg-gray-400">
                             {isSaving ? 'Devolvendo...' : 'Confirmar Devolução'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary">Inventário de Equipamentos</h2>
                <div className="flex flex-wrap gap-2 self-start sm:self-center">
                    {isAdmin && settings.hasInitialConsolidationRun && (
                        <button onClick={() => setIsUpdateModalOpen(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2">
                            <Icon name="History" size={18}/> Atualização Periódica (CSV)
                        </button>
                    )}
                    {isAdmin && (
                        <button onClick={handleExportToXlsx} className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 flex items-center gap-2">
                            <Icon name="FileDown" size={18}/> Exportar para Excel
                        </button>
                    )}
                    <button onClick={() => handleOpenFormModal()} className="bg-brand-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                        <Icon name="CirclePlus" size={18}/> Novo Equipamento
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                <input
                    type="text"
                    placeholder="Buscar equipamento..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary"
                />
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary">
                    <option value="">Todos os Status</option>
                    {uniqueStatuses.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary">
                    <option value="">Todos os Tipos</option>
                    {uniqueTypes.map(type => (
                        <option key={type} value={type}>{type}</option>
                    ))}
                </select>
                <select value={filterGrupoPoliticas} onChange={(e) => setFilterGrupoPoliticas(e.target.value)} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-dark-text-primary">
                    <option value="">Todos os Grupos de Política</option>
                    {uniqueGrupoPoliticas.map(grupo => (
                        <option key={grupo} value={grupo}>{grupo}</option>
                    ))}
                </select>
            </div>
            
            {loading ? (
                <div className="flex justify-center items-center py-10">
                    <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
                </div>
            ) : (
                <>
                    {/* Mobile View */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:hidden">
                        {filteredEquipment.map(item => (
                            <div key={item.id} className="bg-gray-50 dark:bg-dark-bg rounded-lg shadow p-4 space-y-2 border dark:border-dark-border" onClick={() => handleOpenDetailModal(item)}>
                                <div className="flex justify-between items-start">
                                    <p className="font-bold text-brand-secondary dark:text-dark-text-primary">{item.equipamento}</p>
                                    <StatusBadge status={item.approval_status} reason={item.rejection_reason} />
                                </div>
                                <p className="text-sm text-gray-500 dark:text-dark-text-secondary"><strong>Serial:</strong> {item.serial}</p>
                                <p className="text-sm text-gray-500 dark:text-dark-text-secondary"><strong>Usuário:</strong> {item.usuarioAtual || 'N/A'}</p>
                                <p className="text-sm text-gray-500 dark:text-dark-text-secondary"><strong>Status:</strong> {item.status}</p>
                                <p className="text-sm text-gray-500 dark:text-dark-text-secondary"><strong>Termo:</strong> <TermoStatusBadge condicao={item.condicaoTermo} /></p>
                                <div className="flex justify-end pt-2">
                                    <ActionButtons item={item} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop View */}
                    <div className="overflow-x-auto hidden lg:block border dark:border-dark-border rounded-lg">
                        <table className="w-full text-sm text-left text-gray-700 dark:text-dark-text-secondary">
                            <thead className="text-xs text-gray-800 dark:text-dark-text-primary uppercase bg-gray-100 dark:bg-gray-900/50">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Equipamento</th>
                                    <th scope="col" className="px-6 py-3">Serial</th>
                                    <th scope="col" className="px-6 py-3">Usuário Atual</th>
                                    <th scope="col" className="px-6 py-3">Local</th>
                                    <th scope="col" className="px-6 py-3">Status</th>
                                    <th scope="col" className="px-6 py-3">Condição do Termo</th>
                                    <th scope="col" className="px-6 py-3">Grupo de Política</th>
                                    <th scope="col" className="px-6 py-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEquipment.map(item => (
                                    <tr key={item.id} className={`border-b dark:border-dark-border last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 ${item.approval_status === 'pending_approval' ? 'bg-yellow-50 dark:bg-yellow-900/20' : item.approval_status === 'rejected' ? 'bg-red-50 dark:bg-red-900/20 opacity-70' : 'bg-white dark:bg-dark-card'}`} onClick={() => handleOpenDetailModal(item)}>
                                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-dark-text-primary">
                                            {item.equipamento} <StatusBadge status={item.approval_status} reason={item.rejection_reason} />
                                        </td>
                                        <td className="px-6 py-4">{item.serial}</td>
                                        <td className="px-6 py-4">{item.usuarioAtual || 'N/A'}</td>
                                        <td className="px-6 py-4">{item.local || 'N/A'}</td>
                                        <td className="px-6 py-4">{item.status || 'N/A'}</td>
                                        <td className="px-6 py-4"><TermoStatusBadge condicao={item.condicaoTermo} /></td>
                                        <td className="px-6 py-4">{item.grupoPoliticas || 'N/A'}</td>
                                        <td className="px-6 py-4 text-right">
                                            <ActionButtons item={item} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {filteredEquipment.length === 0 && !loading && (
                <div className="text-center py-10 text-gray-500 dark:text-dark-text-secondary">
                    <Icon name="SearchX" size={48} className="mx-auto text-gray-400 mb-4" />
                    <p>Nenhum equipamento encontrado com os filtros atuais.</p>
                </div>
            )}

            {isFormModalOpen && <EquipmentFormModal equipment={editingEquipment} onClose={handleCloseFormModal} onSave={handleSave} currentUser={currentUser} />}
            {isDetailModalOpen && viewingEquipment && <EquipmentDetailModal equipment={viewingEquipment} onClose={handleCloseDetailModal} onEdit={handleOpenFormModal} onDelete={handleDelete} onEntregar={handleOpenEntregaModal} onDevolver={handleOpenDevolucaoModal} currentUser={currentUser} />}
            {isHistoryModalOpen && viewingEquipment && <EquipmentHistoryModal equipmentId={viewingEquipment.id} onClose={handleCloseHistoryModal} />}
            {termoData && <TermoResponsabilidade equipment={termoData.equipment} user={currentUser} onClose={handleCloseTermo} companyName={companyName} termoType={termoData.type} />}
            {entregaEquipment && <EntregaEquipamentoModal equipment={entregaEquipment} onClose={() => setEntregaEquipment(null)} onSave={handleSaveEntrega} />}
            {devolucaoEquipment && <DevolucaoEquipamentoModal equipment={devolucaoEquipment} onClose={() => setDevolucaoEquipment(null)} onConfirm={handleConfirmDevolucao} />}

            {isUpdateModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                         <div className="p-4 border-b dark:border-dark-border flex justify-between items-center">
                            <h3 className="text-lg font-bold">Atualização Periódica de Inventário</h3>
                            <button onClick={() => setIsUpdateModalOpen(false)}><Icon name="X" /></button>
                        </div>
                        <div className="p-4 overflow-y-auto">
                            <PeriodicUpdate currentUser={currentUser} onUpdateSuccess={handleUpdateSuccess} />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default EquipmentList;