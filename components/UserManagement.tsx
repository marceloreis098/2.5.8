import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import Icon from './common/Icon';
import { getUsers, addUser, updateUser, deleteUser, disableUser2FA } from '../services/apiService';
import Admin2FASetupModal from './Admin2FASetupModal'; // Novo import

const UserFormModal: React.FC<{
    user: User | null;
    onClose: () => void;
    onSave: () => void;
    currentUser: User;
}> = ({ user, onClose, onSave, currentUser }) => {
    // FIX: Add `is2FAEnabled` to formData with a default value.
    // Also, explicitly type the formData to match the expected structure, omitting fields not managed by this form.
    const [formData, setFormData] = useState<Omit<User, 'id' | 'lastLogin' | 'avatarUrl' | 'ssoProvider'>>({
        realName: '',
        username: '',
        email: '',
        role: UserRole.User,
        password: '',
        is2FAEnabled: false, // Default to false for new users
    });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData({
                realName: user.realName,
                username: user.username,
                email: user.email,
                role: user.role,
                password: '', // Password is not pre-filled for security
                is2FAEnabled: user.is2FAEnabled, // Preserve existing 2FA status for editing
            });
        }
    }, [user]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            if (user) {
                // Update user
                const updatedData: User = { ...user, ...formData };
                 if (!formData.password) { // Don't update password if it's empty
                    delete updatedData.password;
                }
                await updateUser(updatedData, currentUser.username);
            } else {
                // Add user
                await addUser(formData, currentUser.username);
            }
            onSave();
            onClose();
        } catch (error) {
            console.error("Failed to save user", error);
        } finally {
            setIsSaving(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b dark:border-dark-border">
                        <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">
                            {user ? 'Editar Usuário' : 'Novo Usuário'}
                        </h3>
                    </div>
                    <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input type="text" name="realName" placeholder="Nome Real" value={formData.realName} onChange={handleChange} className="sm:col-span-2 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                        <input type="text" name="username" placeholder="Nome de Usuário" value={formData.username} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                        <input type="email" name="email" placeholder="E-mail" value={formData.email} onChange={handleChange} className="p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                         <div className="sm:col-span-2">
                             <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Permissão (Role)</label>
                            <select name="role" value={formData.role} onChange={handleChange} className="w-full p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800">
                                {Object.values(UserRole).map(role => (
                                    <option key={role} value={role} disabled={role === UserRole.Admin && currentUser.role !== UserRole.Admin}>{role}</option>
                                ))}
                            </select>
                        </div>
                        <input type="password" name="password" placeholder={user ? 'Deixe em branco para não alterar' : 'Senha'} value={formData.password} onChange={handleChange} className="sm:col-span-2 p-2 border dark:border-dark-border rounded-md bg-white dark:bg-gray-800" />
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                        <button type="submit" disabled={isSaving} className="bg-brand-primary text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400">
                            {isSaving ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


interface UserManagementProps {
    currentUser: User;
}

const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userToDisable2FA, setUserToDisable2FA] = useState<User | null>(null);
    const [userForAdmin2FASetup, setUserForAdmin2FASetup] = useState<User | null>(null);
    const [isDisabling, setIsDisabling] = useState(false);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await getUsers();
            setUsers(data);
        } catch (error) {
            console.error("Failed to load users", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const canEdit = (user: User) => {
        if (currentUser.role === UserRole.Admin) return true;
        if (currentUser.role === UserRole.UserManager && user.role !== UserRole.Admin) return true;
        return false;
    }

    const handleOpenModal = (user: User | null = null) => {
        setEditingUser(user);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setEditingUser(null);
        setIsModalOpen(false);
    };

    const handleSave = () => {
        loadUsers();
    };

    const handleDelete = async (userId: number) => {
        if (window.confirm("Tem certeza que deseja excluir este usuário?")) {
            try {
                await deleteUser(userId, currentUser.username);
                loadUsers();
            } catch (error) {
                console.error("Failed to delete user", error);
            }
        }
    };
    
    const handleOpen2FASetupModal = (user: User) => {
        setUserForAdmin2FASetup(user);
    };
    
    const handle2FASetupSuccess = () => {
        setUserForAdmin2FASetup(null);
        loadUsers(); // Recarrega a lista para mostrar o novo status "Ativado"
    };


    const handleConfirmDisable2FA = async () => {
        if (!userToDisable2FA) return;

        setIsDisabling(true);
        try {
            await disableUser2FA(userToDisable2FA.id);
            await loadUsers();
            setUserToDisable2FA(null);
        } catch (error) {
            console.error("Failed to disable 2FA for user", error);
            alert("Falha ao desativar o 2FA. Tente novamente.");
        } finally {
            setIsDisabling(false);
        }
    };

    const RoleBadge: React.FC<{role: UserRole}> = ({role}) => (
         <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
            role === UserRole.Admin ? 'bg-red-200 text-red-800' : 
            role === UserRole.UserManager ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800'
         }`}>
            {role}
        </span>
    );

    const ActionButtons: React.FC<{user: User}> = ({user}) => (
        <>
        {canEdit(user) ? (
            <div className="flex items-center gap-4">
                <button onClick={() => handleOpenModal(user)} title="Editar" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"><Icon name="Pencil" size={16} /></button>
                {currentUser.role === UserRole.Admin && !user.is2FAEnabled && !user.ssoProvider && (
                     <button onClick={() => handleOpen2FASetupModal(user)} className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300" title="Configurar 2FA">
                        <Icon name="Smartphone" size={16} />
                    </button>
                )}
                {currentUser.role === UserRole.Admin && user.is2FAEnabled && !user.ssoProvider && user.id !== currentUser.id && (
                     <button onClick={() => setUserToDisable2FA(user)} className="text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300" title="Desativar 2FA">
                        <Icon name="ShieldOff" size={16} />
                    </button>
                )}
                <button onClick={() => handleDelete(user.id)} title="Excluir" className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"><Icon name="Trash2" size={16} /></button>
            </div>
        ) : (
            <span className="text-gray-400 dark:text-gray-500" title="Permissões insuficientes"><Icon name="Lock" size={16}/></span>
        )}
        </>
    );

    const TwoFactorStatus: React.FC<{user: User}> = ({user}) => {
        if (user.ssoProvider) {
            return <span className="text-gray-500 flex items-center gap-1 text-xs"><Icon name="KeyRound" size={14}/> SSO</span>
        }
        return user.is2FAEnabled ? (
            <span className="text-green-600 flex items-center gap-1 text-xs"><Icon name="ShieldCheck" size={14}/> Ativado</span>
        ) : (
            <span className="text-gray-500 flex items-center gap-1 text-xs"><Icon name="ShieldOff" size={14}/> Desativado</span>
        )
    };

    return (
        <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 className="text-2xl font-bold text-brand-dark dark:text-dark-text-primary">Usuários e Permissões</h2>
                {currentUser.role !== UserRole.User && (
                    <button onClick={() => handleOpenModal()} className="bg-brand-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 self-start sm:self-center">
                        <Icon name="UserPlus" size={18}/> Novo Usuário
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-10">
                    <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
                </div>
            ) : (
                <>
                    {/* Mobile View */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:hidden">
                        {users.map(user => (
                            <div key={user.id} className="bg-gray-50 dark:bg-dark-bg rounded-lg shadow p-4 space-y-2 border dark:border-dark-border">
                            <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-bold text-brand-secondary dark:text-dark-text-primary">{user.realName}</p>
                                        <p className="text-sm text-gray-500 dark:text-dark-text-secondary">{user.username}</p>
                                    </div>
                                    <RoleBadge role={user.role} />
                            </div>
                            <p className="text-sm text-gray-600 dark:text-dark-text-secondary break-all"><strong>Email:</strong> {user.email}</p>
                            <p className="text-sm text-gray-600 dark:text-dark-text-secondary"><strong>Último Login:</strong> {user.lastLogin}</p>
                            <p className="text-sm text-gray-600 dark:text-dark-text-secondary"><strong>Status 2FA:</strong> <TwoFactorStatus user={user}/></p>

                            <div className="flex justify-end pt-2">
                                    <ActionButtons user={user} />
                            </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop View */}
                    <div className="overflow-x-auto hidden lg:block">
                        <table className="w-full text-sm text-left text-gray-700 dark:text-dark-text-secondary">
                            <thead className="text-xs text-gray-800 dark:text-dark-text-primary uppercase bg-gray-100 dark:bg-gray-900/50">
                                <tr>
                                    <th className="px-4 py-3">Nome Real</th>
                                    <th className="px-4 py-3">Usuário</th>
                                    <th className="px-4 py-3">E-mail</th>
                                    <th className="px-4 py-3">Permissão</th>
                                    <th className="px-4 py-3">Status 2FA</th>
                                    <th className="px-4 py-3">Último login</th>
                                    <th className="px-4 py-3">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user.id} className="bg-white dark:bg-dark-card border-b dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-dark-text-primary">{user.realName}</td>
                                        <td className="px-4 py-3">{user.username}</td>
                                        <td className="px-4 py-3">{user.email}</td>
                                        <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                                        <td className="px-4 py-3"><TwoFactorStatus user={user} /></td>
                                        <td className="px-4 py-3">{user.lastLogin}</td>
                                        <td className="px-4 py-3"><ActionButtons user={user} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            {isModalOpen && <UserFormModal user={editingUser} onClose={handleCloseModal} onSave={handleSave} currentUser={currentUser} />}

            {userForAdmin2FASetup && (
                <Admin2FASetupModal 
                    user={userForAdmin2FASetup} 
                    onClose={() => setUserForAdmin2FASetup(null)} 
                    onSuccess={handle2FASetupSuccess} 
                />
            )}

            {userToDisable2FA && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl w-full max-w-md">
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary">Confirmar Ação</h3>
                            <p className="mt-2 text-gray-600 dark:text-dark-text-secondary">
                                Você tem certeza que deseja desativar a autenticação de dois fatores (2FA) para o usuário <strong>{userToDisable2FA.realName}</strong> ({userToDisable2FA.username})?
                            </p>
                            <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                                Esta ação reduzirá a segurança da conta do usuário.
                            </p>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-dark-card/50 border-t dark:border-dark-border flex justify-end gap-3">
                            <button onClick={() => setUserToDisable2FA(null)} className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancelar</button>
                            <button onClick={handleConfirmDisable2FA} disabled={isDisabling} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:bg-gray-400">
                                {isDisabling ? 'Desativando...' : 'Confirmar e Desativar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;