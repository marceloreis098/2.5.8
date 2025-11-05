import { User, Equipment, License, UserRole, EquipmentHistory, AuditLogEntry, AppSettings } from '../types';

const API_BASE_URL = `http://${window.location.hostname}:3001/api`;

const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));
        throw new Error(errorData.message || 'An unknown error occurred');
    }
    return response.json();
};

const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    return handleResponse(response);
};

export const checkApiStatus = async (): Promise<{ ok: boolean, message?: string }> => {
    try {
        const response = await fetch(`${API_BASE_URL}`);
        if (!response.ok) {
            throw new Error(`O servidor respondeu com o status: ${response.status}`);
        }
        await response.json();
        return { ok: true };
    } catch (error: any) {
        return { ok: false, message: 'Falha ao conectar com a API. Verifique se o servidor backend (na porta 3001) está em execução e se o firewall permite a conexão.' };
    }
};

export const login = (credentials: {username: string, password?: string, ssoToken?: string}): Promise<User> => {
    return apiRequest('/login', { method: 'POST', body: JSON.stringify(credentials) });
};

export const verify2FA = (userId: number, token: string): Promise<User> => {
    return apiRequest('/verify-2fa', { method: 'POST', body: JSON.stringify({ userId, token }) });
};

export const getEquipment = (user: User): Promise<Equipment[]> => {
    return apiRequest(`/equipment?userId=${user.id}&role=${user.role}`);
};

export const getEquipmentHistory = (equipmentId: number): Promise<EquipmentHistory[]> => {
    return apiRequest(`/equipment/${equipmentId}/history`);
};

export const addEquipment = (equipment: Omit<Equipment, 'id'>, user: User): Promise<Equipment> => {
    return apiRequest('/equipment', { method: 'POST', body: JSON.stringify({ equipment, username: user.username }) });
};

export const updateEquipment = (equipment: Equipment, username: string): Promise<Equipment> => {
    return apiRequest(`/equipment/${equipment.id}`, { method: 'PUT', body: JSON.stringify({ equipment, username }) });
};

export const deleteEquipment = (id: number, username: string): Promise<void> => {
    return apiRequest(`/equipment/${id}`, { method: 'DELETE', body: JSON.stringify({ username }) });
};

export const importEquipment = (data: Omit<Equipment, 'id'>[], username: string): Promise<{success: boolean, message: string}> => {
    return apiRequest('/equipment/import', { method: 'POST', body: JSON.stringify({ equipmentList: data, username }) });
}

export const periodicUpdateEquipment = (data: Omit<Equipment, 'id'>[], username: string): Promise<{success: boolean, message: string}> => {
    return apiRequest('/equipment/periodic-update', { method: 'POST', body: JSON.stringify({ equipmentList: data, username }) });
}

export const getLicenses = (user: User): Promise<License[]> => {
    return apiRequest(`/licenses?userId=${user.id}&role=${user.role}`);
};

export const addLicense = (license: Omit<License, 'id'>, user: User): Promise<License> => {
    return apiRequest('/licenses', { method: 'POST', body: JSON.stringify({ license, username: user.username }) });
};

export const updateLicense = (license: License, username: string): Promise<License> => {
    return apiRequest(`/licenses/${license.id}`, { method: 'PUT', body: JSON.stringify({ license, username }) });
};

export const deleteLicense = (id: number, username: string): Promise<void> => {
    return apiRequest(`/licenses/${id}`, { method: 'DELETE', body: JSON.stringify({ username }) });
};

export const getUsers = (): Promise<User[]> => {
    return apiRequest('/users');
};

export const addUser = (user: Omit<User, 'id'>, username: string): Promise<User> => {
    return apiRequest('/users', { method: 'POST', body: JSON.stringify({ user, username }) });
};

export const updateUser = (user: User, username: string): Promise<User> => {
    return apiRequest(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ user, username }) });
};

export const updateUserProfile = (userId: number, profileData: { realName: string; avatarUrl: string }): Promise<User> => {
    return apiRequest(`/users/${userId}/profile`, { method: 'PUT', body: JSON.stringify(profileData) });
};

export const deleteUser = (id: number, username: string): Promise<void> => {
    return apiRequest(`/users/${id}`, { method: 'DELETE', body: JSON.stringify({ username }) });
};

export const getAuditLog = (): Promise<AuditLogEntry[]> => {
    return apiRequest('/audit-log');
};

export const getPendingApprovals = (): Promise<{id: number, name: string, type: 'equipment' | 'license'}[]> => {
    return apiRequest('/approvals/pending');
};

export const approveItem = (type: 'equipment' | 'license', id: number, username: string): Promise<void> => {
    return apiRequest(`/approvals/approve`, { method: 'POST', body: JSON.stringify({ type, id, username }) });
};

export const rejectItem = (type: 'equipment' | 'license', id: number, username: string, reason: string): Promise<void> => {
    return apiRequest(`/approvals/reject`, { method: 'POST', body: JSON.stringify({ type, id, username, reason }) });
};

export const getLicenseTotals = (): Promise<Record<string, number>> => {
    return apiRequest('/licenses/totals');
};

export const saveLicenseTotals = (totals: Record<string, number>, username: string): Promise<{ success: boolean; message: string; }> => {
    return apiRequest('/licenses/totals', { method: 'POST', body: JSON.stringify({ totals, username }) });
};

export const renameProduct = (oldName: string, newName: string, username: string): Promise<void> => {
    return apiRequest('/licenses/rename-product', { method: 'POST', body: JSON.stringify({ oldName, newName, username }) });
};

export interface LicenseImportData {
    productName: string;
    licenses: Omit<License, 'id' | 'produto'>[];
}

export const importLicenses = (data: LicenseImportData, username: string): Promise<{success: boolean, message: string}> => {
    return apiRequest('/licenses/import', { method: 'POST', body: JSON.stringify({ ...data, username }) });
}

// 2FA Endpoints
export const generate2FASecret = (userId: number): Promise<{ secret: string; qrCodeUrl: string; }> => {
    return apiRequest('/generate-2fa', { method: 'POST', body: JSON.stringify({ userId }) });
};

export const enable2FA = (userId: number, token: string): Promise<void> => {
    return apiRequest('/enable-2fa', { method: 'POST', body: JSON.stringify({ userId, token }) });
};

export const disable2FA = (userId: number): Promise<void> => {
    return apiRequest('/disable-2fa', { method: 'POST', body: JSON.stringify({ userId }) });
};

export const disableUser2FA = (userId: number): Promise<void> => {
    return apiRequest('/disable-user-2fa', { method: 'POST', body: JSON.stringify({ userId }) });
};


// Settings Endpoints
export const getSettings = (): Promise<AppSettings> => {
    return apiRequest('/settings');
};

export const saveSettings = (settings: AppSettings, username: string): Promise<{ success: boolean; message: string; lastAbsoluteUpdateTimestamp?: string; hasInitialConsolidationRun?: boolean; }> => {
    return apiRequest('/settings', { method: 'POST', body: JSON.stringify({ settings, username }) });
};

export const testSmtp = (settings: Partial<AppSettings>): Promise<{success: boolean; message: string;}> => {
     return apiRequest('/settings/test-smtp', { method: 'POST', body: JSON.stringify(settings) });
}

// Termo Template Endpoints
export const getTermoTemplates = (): Promise<{ entregaTemplate: string, devolucaoTemplate: string }> => {
    return apiRequest('/config/termo-templates');
};

// Database Management Endpoints
export const checkDatabaseBackupStatus = (): Promise<{ hasBackup: boolean; backupTimestamp?: string }> => {
    return apiRequest('/database/backup-status');
};

export const backupDatabase = (username: string): Promise<{ success: boolean; message: string; backupTimestamp?: string }> => {
    return apiRequest('/database/backup', { method: 'POST', body: JSON.stringify({ username }) });
};

export const restoreDatabase = (username: string): Promise<{ success: boolean; message: string }> => {
    return apiRequest('/database/restore', { method: 'POST', body: JSON.stringify({ username }) });
};

export const clearDatabase = (username: string): Promise<{ success: boolean; message: string }> => {
    return apiRequest('/database/clear', { method: 'POST', body: JSON.stringify({ username }) });
};