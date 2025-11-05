const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let db;

const MIGRATIONS_TABLE = `
    CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_number INT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

const MIGRATION_1 = `
    CREATE TABLE IF NOT EXISTS equipment (
        id INT AUTO_INCREMENT PRIMARY KEY,
        equipamento VARCHAR(255) NOT NULL,
        garantia VARCHAR(255),
        patrimonio VARCHAR(255) UNIQUE,
        serial VARCHAR(255) UNIQUE,
        usuarioAtual VARCHAR(255),
        usuarioAnterior VARCHAR(255),
        local VARCHAR(255),
        setor VARCHAR(255),
        dataEntregaUsuario DATE,
        status VARCHAR(255),
        dataDevolucao DATE,
        tipo VARCHAR(255),
        notaCompra VARCHAR(255),
        notaPlKm VARCHAR(255),
        termoResponsabilidade VARCHAR(255),
        foto LONGTEXT,
        qrCode VARCHAR(255)
    );
`;

const MIGRATION_2 = `
    CREATE TABLE IF NOT EXISTS licenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produto VARCHAR(255) NOT NULL,
        tipoLicenca VARCHAR(255),
        chaveSerial VARCHAR(255) NOT NULL,
        dataExpiracao DATE,
        usuario VARCHAR(255) NOT NULL,
        cargo VARCHAR(255),
        setor VARCHAR(255),
        gestor VARCHAR(255),
        centroCusto VARCHAR(255),
        contaRazao VARCHAR(255),
        nomeComputador VARCHAR(255),
        numeroChamado VARCHAR(255),
        observacoes TEXT
    );
`;

const MIGRATION_3 = `
    CREATE TABLE IF NOT EXISTS equipment_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        equipment_id INT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        changedBy VARCHAR(255) NOT NULL,
        changeType VARCHAR(255) NOT NULL,
        from_value TEXT,
        to_value TEXT,
        FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
`;

const MIGRATION_4 = `
    ALTER TABLE equipment ADD COLUMN brand VARCHAR(255), ADD COLUMN model VARCHAR(255), ADD COLUMN observacoes TEXT;
`;

const MIGRATION_5 = `
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('Admin', 'User Manager', 'User') NOT NULL,
        lastLogin TIMESTAMP NULL
    );
`;

const MIGRATION_6 = `
    INSERT INTO users (username, password, role) VALUES ('admin', '${bcrypt.hashSync('marceloadmin', 10)}', 'Admin')
    ON DUPLICATE KEY UPDATE username=username;
`;

const MIGRATION_7 = `
    CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        target_type VARCHAR(50),
        target_id VARCHAR(255),
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;
const MIGRATION_8 = `
    ALTER TABLE equipment ADD COLUMN approval_status VARCHAR(50) DEFAULT 'approved', ADD COLUMN rejection_reason TEXT;
`;

const MIGRATION_9 = `
    ALTER TABLE licenses ADD COLUMN approval_status VARCHAR(50) DEFAULT 'approved', ADD COLUMN rejection_reason TEXT;
`;

const MIGRATION_10 = `
    ALTER TABLE equipment ADD COLUMN created_by_id INT, ADD CONSTRAINT fk_equipment_user FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
`;

const MIGRATION_11 = `
    ALTER TABLE licenses ADD COLUMN created_by_id INT, ADD CONSTRAINT fk_license_user FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
`;

const MIGRATION_12 = `
    ALTER TABLE users ADD COLUMN is2FAEnabled BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN twoFASecret VARCHAR(255);
`;

const MIGRATION_13 = `
    ALTER TABLE users ADD COLUMN realName VARCHAR(255) NOT NULL DEFAULT 'Usuário Padrão';
`;
const MIGRATION_14 = `
    UPDATE users SET realName = username WHERE realName = 'Usuário Padrão';
`;
const MIGRATION_15 = `
    ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT 'user@example.com';
`;
const MIGRATION_16 = `
    CREATE TABLE IF NOT EXISTS license_totals (
        product_name VARCHAR(255) PRIMARY KEY,
        total_licenses INT NOT NULL DEFAULT 0
    );
`;
const MIGRATION_17 = `
    ALTER TABLE users ADD COLUMN avatarUrl TEXT;
`;

const MIGRATION_18 = `
    CREATE TABLE IF NOT EXISTS app_config (
        config_key VARCHAR(255) PRIMARY KEY,
        config_value TEXT
    );
`;
const MIGRATION_19 = `
    ALTER TABLE equipment ADD COLUMN emailColaborador VARCHAR(255);
`;
const MIGRATION_20 = `
    ALTER TABLE equipment 
        ADD COLUMN identificador VARCHAR(255),
        ADD COLUMN nomeSO VARCHAR(255),
        ADD COLUMN memoriaFisicaTotal VARCHAR(255),
        ADD COLUMN grupoPoliticas VARCHAR(255),
        ADD COLUMN pais VARCHAR(255),
        ADD COLUMN cidade VARCHAR(255),
        ADD COLUMN estadoProvincia VARCHAR(255),
        ADD COLUMN condicaoTermo ENUM('Assinado - Entrega', 'Assinado - Devolução', 'Pendente', 'N/A') DEFAULT 'N/A';
`;
const MIGRATION_21 = `
    INSERT INTO app_config (config_key, config_value) VALUES ('hasInitialConsolidationRun', 'false') ON DUPLICATE KEY UPDATE config_key=config_key;
`;


const logAction = async (username, action_type, target_type, target_id, details, connection) => {
    const dbConnection = connection || db;
    try {
        await dbConnection.query(
            "INSERT INTO audit_log (username, action_type, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
            [username, action_type, target_type, target_id, details]
        );
    } catch (error) {
        console.error("Failed to log action:", error);
    }
};

const runMigration = async (migrationNumber, query) => {
    const [rows] = await db.query('SELECT 1 FROM migrations WHERE migration_number = ?', [migrationNumber]);
    if (rows.length === 0) {
        try {
            console.log(`Running migration ${migrationNumber}...`);
            await db.query(query);
            await db.query('INSERT INTO migrations (migration_number) VALUES (?)', [migrationNumber]);
            console.log(`Migration ${migrationNumber} completed.`);
        } catch (error) {
            // Ignore "Duplicate column name" error, which means the migration partially ran before
            if (error.code !== 'ER_DUP_FIELDNAME' && error.code !== 'ER_DUP_KEYNAME') {
                console.error(`Error running migration ${migrationNumber}:`, error);
                throw error;
            } else {
                 console.log(`Migration ${migrationNumber} already applied (column exists). Skipping.`);
                 // Still record that it's "run" to prevent future attempts
                 await db.query('INSERT INTO migrations (migration_number) VALUES (?)', [migrationNumber]);
            }
        }
    }
};

const initializeDatabase = async () => {
    try {
        const tempConnection = await mysql.createConnection({ ...dbConfig, database: null });
        await tempConnection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
        await tempConnection.end();

        db = await mysql.createPool(dbConfig);
        console.log('Connected to the database.');

        await db.query(MIGRATIONS_TABLE);
        await runMigration(1, MIGRATION_1);
        await runMigration(2, MIGRATION_2);
        await runMigration(3, MIGRATION_3);
        await runMigration(4, MIGRATION_4);
        await runMigration(5, MIGRATION_5);
        await runMigration(6, MIGRATION_6);
        await runMigration(7, MIGRATION_7);
        await runMigration(8, MIGRATION_8);
        await runMigration(9, MIGRATION_9);
        await runMigration(10, MIGRATION_10);
        await runMigration(11, MIGRATION_11);
        await runMigration(12, MIGRATION_12);
        await runMigration(13, MIGRATION_13);
        await runMigration(14, MIGRATION_14);
        await runMigration(15, MIGRATION_15);
        await runMigration(16, MIGRATION_16);
        await runMigration(17, MIGRATION_17);
        await runMigration(18, MIGRATION_18);
        await runMigration(19, MIGRATION_19);
        await runMigration(20, MIGRATION_20);
        await runMigration(21, MIGRATION_21);

    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1);
    }
};

// Simple endpoint to check API status
app.get('/api', (req, res) => {
    res.json({ message: 'API is running' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const user = rows[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        const [settingsRows] = await db.query("SELECT * FROM app_config WHERE config_key = 'require2fa'");
        const require2fa = settingsRows.length > 0 && settingsRows[0].config_value === 'true';

        if (require2fa && !user.is2FAEnabled) {
             const { password, twoFASecret, ...userResponse } = user;
             return res.json({ ...userResponse, requires2FASetup: true });
        }

        await db.query('UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
        await logAction(username, 'LOGIN', 'USER', user.id, 'User logged in successfully');
        
        const { password: userPassword, twoFASecret, ...userResponse } = user;
        res.json(userResponse);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.post('/api/verify-2fa', async (req, res) => {
    const { userId, token } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const user = rows[0];
        const isValid = authenticator.verify({ token, secret: user.twoFASecret });

        if (isValid) {
            await db.query('UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
            await logAction(user.username, 'LOGIN', 'USER', user.id, 'User completed 2FA verification');
            const { password, twoFASecret, ...userResponse } = user;
            res.json(userResponse);
        } else {
            res.status(401).json({ message: 'Invalid 2FA token' });
        }
    } catch (error) {
        console.error('2FA verification error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


// GET all equipment
app.get('/api/equipment', async (req, res) => {
    const { userId, role } = req.query;
    try {
        let query = 'SELECT * FROM equipment';
        // Non-admins can only see approved items or items they created themselves
        if (role !== 'Admin') {
            query += ` WHERE approval_status = 'approved' OR created_by_id = ?`;
        }
        const [rows] = await db.query(query, [userId]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching equipment:', error);
        res.status(500).json({ message: 'Error fetching equipment' });
    }
});

app.get('/api/equipment/:id/history', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            "SELECT id, timestamp, changedBy, changeType, from_value, to_value FROM equipment_history WHERE equipment_id = ? ORDER BY timestamp DESC",
            [id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching equipment history:', error);
        res.status(500).json({ message: 'Error fetching equipment history' });
    }
});

// ADD new equipment
app.post('/api/equipment', async (req, res) => {
    const { equipment, username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [userRows] = await connection.query('SELECT id, role FROM users WHERE username = ?', [username]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const user = userRows[0];
        
        const approval_status = user.role === 'Admin' ? 'approved' : 'pending_approval';
        
        const [serialResult] = await connection.query('SELECT id FROM equipment WHERE serial = ?', [equipment.serial]);
        if (serialResult.length > 0) {
            throw new Error(`O Serial "${equipment.serial}" já está cadastrado no sistema.`);
        }

        const [result] = await connection.query(
            'INSERT INTO equipment (equipamento, patrimonio, serial, brand, model, tipo, status, usuarioAtual, emailColaborador, local, setor, dataEntregaUsuario, approval_status, created_by_id, identificador, nomeSO, memoriaFisicaTotal, grupoPoliticas, pais, cidade, estadoProvincia, condicaoTermo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [equipment.equipamento, equipment.patrimonio, equipment.serial, equipment.brand, equipment.model, equipment.tipo, equipment.status, equipment.usuarioAtual, equipment.emailColaborador, equipment.local, equipment.setor, equipment.dataEntregaUsuario || null, approval_status, user.id, equipment.identificador, equipment.nomeSO, equipment.memoriaFisicaTotal, equipment.grupoPoliticas, equipment.pais, equipment.cidade, equipment.estadoProvincia, equipment.condicaoTermo]
        );
        const newEquipmentId = result.insertId;
        
        await logAction(username, 'CREATE', 'EQUIPMENT', newEquipmentId, `Created equipment: ${equipment.equipamento}`, connection);

        await connection.commit();
        res.status(201).json({ id: newEquipmentId, ...equipment });
    } catch (error) {
        await connection.rollback();
        console.error('Error adding equipment:', error);
        res.status(500).json({ message: error.message || 'Error adding equipment' });
    } finally {
        connection.release();
    }
});

// UPDATE equipment
app.put('/api/equipment/:id', async (req, res) => {
    const { id } = req.params;
    const { equipment, username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [originalRows] = await connection.query('SELECT * FROM equipment WHERE id = ?', [id]);
        if (originalRows.length === 0) {
            return res.status(404).json({ message: 'Equipment not found' });
        }
        const original = originalRows[0];

        const changes = [];
        for (const key in equipment) {
            if (key !== 'id' && original[key] !== equipment[key]) {
                changes.push({
                    equipment_id: id,
                    changedBy: username,
                    changeType: key,
                    from_value: original[key] ? String(original[key]) : null,
                    to_value: equipment[key] ? String(equipment[key]) : null,
                });
            }
        }
        
        if (changes.length > 0) {
            for (const change of changes) {
                 await connection.query(
                    'INSERT INTO equipment_history (equipment_id, changedBy, changeType, from_value, to_value) VALUES (?, ?, ?, ?, ?)',
                    [change.equipment_id, change.changedBy, change.changeType, change.from_value, change.to_value]
                );
            }
        }

        await connection.query(
            `UPDATE equipment SET equipamento = ?, patrimonio = ?, serial = ?, brand = ?, model = ?, tipo = ?, status = ?, usuarioAtual = ?, emailColaborador = ?, local = ?, setor = ?, dataEntregaUsuario = ?, dataDevolucao = ?, garantia = ?, notaCompra = ?, notaPlKm = ?, termoResponsabilidade = ?, foto = ?, observacoes = ?, identificador = ?, nomeSO = ?, memoriaFisicaTotal = ?, grupoPoliticas = ?, pais = ?, cidade = ?, estadoProvincia = ?, condicaoTermo = ? WHERE id = ?`,
            [equipment.equipamento, equipment.patrimonio, equipment.serial, equipment.brand, equipment.model, equipment.tipo, equipment.status, equipment.usuarioAtual, equipment.emailColaborador, equipment.local, equipment.setor, equipment.dataEntregaUsuario || null, equipment.dataDevolucao || null, equipment.garantia, equipment.notaCompra, equipment.notaPlKm, equipment.termoResponsabilidade, equipment.foto, equipment.observacoes, equipment.identificador, equipment.nomeSO, equipment.memoriaFisicaTotal, equipment.grupoPoliticas, equipment.pais, equipment.cidade, equipment.estadoProvincia, equipment.condicaoTermo, id]
        );
        
        await logAction(username, 'UPDATE', 'EQUIPMENT', id, `Updated equipment: ${equipment.equipamento}`, connection);

        await connection.commit();
        res.json({ id, ...equipment });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating equipment:', error);
        res.status(500).json({ message: 'Error updating equipment' });
    } finally {
        connection.release();
    }
});


// DELETE equipment
app.delete('/api/equipment/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT equipamento FROM equipment WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Equipment not found' });
        }
        const equipmentName = rows[0].equipamento;
        
        await connection.query('DELETE FROM equipment_history WHERE equipment_id = ?', [id]);
        await connection.query('DELETE FROM equipment WHERE id = ?', [id]);
        
        await logAction(username, 'DELETE', 'EQUIPMENT', id, `Deleted equipment: ${equipmentName}`, connection);

        await connection.commit();
        res.status(204).send();
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting equipment:', error);
        res.status(500).json({ message: 'Error deleting equipment' });
    } finally {
        connection.release();
    }
});

// IMPORT equipment
app.post('/api/equipment/import', async (req, res) => {
    const { equipmentList, username } = req.body;
    if (!Array.isArray(equipmentList)) {
        return res.status(400).json({ success: false, message: 'Invalid data format' });
    }
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query('DELETE FROM equipment_history');
        await connection.query('DELETE FROM equipment');
        await connection.query('ALTER TABLE equipment AUTO_INCREMENT = 1');

        for (const equipment of equipmentList) {
            await connection.query(
                'INSERT INTO equipment (equipamento, patrimonio, serial, brand, model, tipo, status, usuarioAtual, emailColaborador, local, setor, dataEntregaUsuario, approval_status, created_by_id, identificador, nomeSO, memoriaFisicaTotal, grupoPoliticas, pais, cidade, estadoProvincia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [equipment.equipamento, equipment.patrimonio, equipment.serial, equipment.brand, equipment.model, equipment.tipo, equipment.status, equipment.usuarioAtual, equipment.emailColaborador, equipment.local, equipment.setor, equipment.dataEntregaUsuario || null, 'approved', 1, equipment.identificador, equipment.nomeSO, equipment.memoriaFisicaTotal, equipment.grupoPoliticas, equipment.pais, equipment.cidade, equipment.estadoProvincia]
            );
        }
        
        const now = new Date().toISOString();
        await connection.query("INSERT INTO app_config (config_key, config_value) VALUES ('lastAbsoluteUpdateTimestamp', ?) ON DUPLICATE KEY UPDATE config_value = ?", [now, now]);
        await connection.query("INSERT INTO app_config (config_key, config_value) VALUES ('hasInitialConsolidationRun', 'true') ON DUPLICATE KEY UPDATE config_value = 'true'");


        await logAction(username, 'IMPORT', 'EQUIPMENT', null, `Imported ${equipmentList.length} equipment items.`);

        await connection.commit();
        res.json({ success: true, message: 'Equipment imported successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error importing equipment:', error);
        res.status(500).json({ success: false, message: 'Error importing equipment' });
    } finally {
        connection.release();
    }
});


// PERIODIC UPDATE equipment
app.post('/api/equipment/periodic-update', async (req, res) => {
    const { equipmentList, username } = req.body;
    if (!Array.isArray(equipmentList)) {
        return res.status(400).json({ success: false, message: 'Invalid data format' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [existingEquipmentRows] = await connection.query('SELECT id, serial, usuarioAtual, status FROM equipment');
        const existingEquipmentMap = new Map(existingEquipmentRows.map(e => [e.serial.toUpperCase(), e]));

        const historyEntries = [];
        const updatePromises = [];
        const insertPromises = [];

        for (const item of equipmentList) {
            const upperSerial = item.serial.toUpperCase();
            const existing = existingEquipmentMap.get(upperSerial);
            
            const newStatus = (item.usuarioAtual || '').trim() !== '' ? 'Em Uso' : 'Estoque';

            if (existing) {
                const updates = {};
                let hasChanges = false;
                
                // Compare and collect changes
                Object.keys(item).forEach(key => {
                    if (key !== 'serial' && item[key] !== existing[key]) {
                        updates[key] = item[key];
                        hasChanges = true;
                        historyEntries.push({ equipment_id: existing.id, changedBy: username, changeType: key, from_value: existing[key], to_value: item[key] });
                    }
                });
                
                // Also check if status needs to change
                if (newStatus !== existing.status) {
                    updates['status'] = newStatus;
                    if (!hasChanges) { // Avoid duplicate history if status change is the only change
                        historyEntries.push({ equipment_id: existing.id, changedBy: username, changeType: 'status', from_value: existing.status, to_value: newStatus });
                    }
                    hasChanges = true;
                }
                
                if (hasChanges) {
                     updatePromises.push(connection.query(
                        'UPDATE equipment SET ? WHERE id = ?',
                        [updates, existing.id]
                    ));
                }

            } else {
                // New equipment
                const newItem = { ...item, status: newStatus, approval_status: 'approved', created_by_id: 1 };
                insertPromises.push(
                    connection.query('INSERT INTO equipment SET ?', [newItem]).then(result => {
                        historyEntries.push({ equipment_id: result[0].insertId, changedBy: username, changeType: 'CREATE', from_value: null, to_value: item.equipamento });
                    })
                );
            }
        }
        
        // Execute all database operations
        await Promise.all([...updatePromises, ...insertPromises]);

        // Bulk insert history
        if (historyEntries.length > 0) {
            await connection.query(
                'INSERT INTO equipment_history (equipment_id, changedBy, changeType, from_value, to_value) VALUES ?',
                [historyEntries.map(e => [e.equipment_id, e.changedBy, e.changeType, e.from_value, e.to_value])]
            );
        }

        const now = new Date().toISOString();
        await connection.query("INSERT INTO app_config (config_key, config_value) VALUES ('lastAbsoluteUpdateTimestamp', ?) ON DUPLICATE KEY UPDATE config_value = ?", [now, now]);

        await logAction(username, 'IMPORT', 'EQUIPMENT', null, `Periodically updated ${equipmentList.length} equipment items.`);
        await connection.commit();
        res.json({ success: true, message: 'Equipment updated successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error in periodic update:', error);
        res.status(500).json({ success: false, message: 'Database error during update: ' + error.message });
    } finally {
        connection.release();
    }
});


// GET all licenses
app.get('/api/licenses', async (req, res) => {
    const { userId, role } = req.query;
    try {
        let query = 'SELECT * FROM licenses';
        if (role !== 'Admin') {
            query += ` WHERE approval_status = 'approved'`; // Non-admins can only see approved licenses
        }
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching licenses:', error);
        res.status(500).json({ message: 'Error fetching licenses' });
    }
});


// ADD new license
app.post('/api/licenses', async (req, res) => {
    const { license, username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [userRows] = await connection.query('SELECT id, role FROM users WHERE username = ?', [username]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const user = userRows[0];
        
        const approval_status = user.role === 'Admin' ? 'approved' : 'pending_approval';

        const [result] = await connection.query(
            'INSERT INTO licenses (produto, tipoLicenca, chaveSerial, dataExpiracao, usuario, cargo, setor, gestor, centroCusto, contaRazao, nomeComputador, numeroChamado, observacoes, approval_status, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [license.produto, license.tipoLicenca, license.chaveSerial, license.dataExpiracao || null, license.usuario, license.cargo, license.setor, license.gestor, license.centroCusto, license.contaRazao, license.nomeComputador, license.numeroChamado, license.observacoes, approval_status, user.id]
        );
        
        const newLicenseId = result.insertId;
        await logAction(username, 'CREATE', 'LICENSE', newLicenseId, `Created license for product: ${license.produto}`, connection);
        
        await connection.commit();
        res.status(201).json({ id: newLicenseId, ...license });
    } catch (error) {
        await connection.rollback();
        console.error('Error adding license:', error);
        res.status(500).json({ message: 'Error adding license' });
    } finally {
        connection.release();
    }
});


// UPDATE license
app.put('/api/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const { license, username } = req.body;
    try {
        await db.query(
            'UPDATE licenses SET produto = ?, tipoLicenca = ?, chaveSerial = ?, dataExpiracao = ?, usuario = ?, cargo = ?, setor = ?, gestor = ?, centroCusto = ?, contaRazao = ?, nomeComputador = ?, numeroChamado = ?, observacoes = ? WHERE id = ?',
            [license.produto, license.tipoLicenca, license.chaveSerial, license.dataExpiracao || null, license.usuario, license.cargo, license.setor, license.gestor, license.centroCusto, license.contaRazao, license.nomeComputador, license.numeroChamado, license.observacoes, id]
        );
        await logAction(username, 'UPDATE', 'LICENSE', id, `Updated license for product: ${license.produto}`);
        res.json({ id, ...license });
    } catch (error) {
        console.error('Error updating license:', error);
        res.status(500).json({ message: 'Error updating license' });
    }
});


// DELETE license
app.delete('/api/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    try {
        const [rows] = await db.query('SELECT produto FROM licenses WHERE id = ?', [id]);
        const productName = rows.length > 0 ? rows[0].produto : `ID ${id}`;
        
        await db.query('DELETE FROM licenses WHERE id = ?', [id]);

        await logAction(username, 'DELETE', 'LICENSE', id, `Deleted license for product: ${productName}`);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting license:', error);
        res.status(500).json({ message: 'Error deleting license' });
    }
});


// Endpoint to get all license totals
app.get('/api/licenses/totals', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT product_name, total_licenses FROM license_totals");
        const totals = rows.reduce((acc, row) => {
            acc[row.product_name] = row.total_licenses;
            return acc;
        }, {});
        res.json(totals);
    } catch (error) {
        console.error('Error fetching license totals:', error);
        res.status(500).json({ message: 'Error fetching license totals' });
    }
});

// Endpoint to save license totals
app.post('/api/licenses/totals', async (req, res) => {
    const { totals, username } = req.body;
    if (!totals || typeof totals !== 'object') {
        return res.status(400).json({ message: 'Invalid totals data provided' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        await connection.query("DELETE FROM license_totals");

        const productNames = Object.keys(totals);
        if (productNames.length > 0) {
            // Using a loop for robust, individual inserts instead of a single bulk insert
            for (const name of productNames) {
                await connection.query(
                    "INSERT INTO license_totals (product_name, total_licenses) VALUES (?, ?)",
                    [name, totals[name]]
                );
            }
        }
        
        await logAction(username, 'UPDATE', 'TOTALS', null, `License totals updated for products: ${productNames.join(', ')}`, connection);

        await connection.commit();
        res.json({ success: true, message: 'License totals saved successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error saving license totals:', error);
        res.status(500).json({ message: 'Error saving license totals' });
    } finally {
        connection.release();
    }
});

// Endpoint to rename a product
app.post('/api/licenses/rename-product', async (req, res) => {
    const { oldName, newName, username } = req.body;
    if (!oldName || !newName) {
        return res.status(400).json({ message: 'Old name and new name are required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            "UPDATE licenses SET produto = ? WHERE produto = ?",
            [newName, oldName]
        );
        await connection.query(
            "UPDATE license_totals SET product_name = ? WHERE product_name = ?",
            [newName, oldName]
        );
        
        await logAction(username, 'UPDATE', 'PRODUCT', oldName, `Product renamed from '${oldName}' to '${newName}'`, connection);

        await connection.commit();
        res.json({ success: true, message: 'Product renamed successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error renaming product:', error);
        res.status(500).json({ message: 'Error renaming product' });
    } finally {
        connection.release();
    }
});

app.post('/api/licenses/import', async (req, res) => {
    const { productName, licenses, username } = req.body;
    if (!productName || !Array.isArray(licenses)) {
        return res.status(400).json({ success: false, message: 'Invalid data format.' });
    }
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query('DELETE FROM licenses WHERE produto = ?', [productName]);

        if (licenses.length > 0) {
            const values = licenses.map(l => [
                productName, l.tipoLicenca, l.chaveSerial, l.dataExpiracao || null, l.usuario,
                l.cargo, l.setor, l.gestor, l.centroCusto, l.contaRazao, l.nomeComputador,
                l.numeroChamado, l.observacoes, 'approved', 1 // Approved by default on import, created by admin (id 1)
            ]);
            await connection.query(
                'INSERT INTO licenses (produto, tipoLicenca, chaveSerial, dataExpiracao, usuario, cargo, setor, gestor, centroCusto, contaRazao, nomeComputador, numeroChamado, observacoes, approval_status, created_by_id) VALUES ?',
                [values]
            );
        }
        
        await logAction(username, 'IMPORT', 'LICENSE', productName, `Imported ${licenses.length} licenses for product ${productName}.`);

        await connection.commit();
        res.json({ success: true, message: `Successfully imported ${licenses.length} licenses for ${productName}.` });
    } catch (error) {
        await connection.rollback();
        console.error('Error importing licenses:', error);
        res.status(500).json({ success: false, message: `Error importing licenses: ${error.message}` });
    } finally {
        connection.release();
    }
});


// GET all users
app.get('/api/users', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, username, realName, email, role, DATE_FORMAT(lastLogin, '%Y-%m-%d %H:%i:%s') as lastLogin, is2FAEnabled, ssoProvider FROM users ORDER BY realName");
        res.json(rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Error fetching users' });
    }
});

app.post('/api/users', async (req, res) => {
    const { user, username } = req.body;
    const hashedPassword = await bcrypt.hash(user.password, 10);
    try {
        const [result] = await db.query(
            'INSERT INTO users (username, password, realName, email, role) VALUES (?, ?, ?, ?, ?)',
            [user.username, hashedPassword, user.realName, user.email, user.role]
        );
        await logAction(username, 'CREATE', 'USER', result.insertId, `Created user: ${user.username}`);
        res.status(201).json({ id: result.insertId, ...user });
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(500).json({ message: 'Error adding user' });
    }
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { user, username } = req.body;
    try {
        let query = 'UPDATE users SET username = ?, realName = ?, email = ?, role = ?';
        const params = [user.username, user.realName, user.email, user.role];
        if (user.password) {
            const hashedPassword = await bcrypt.hash(user.password, 10);
            query += ', password = ?';
            params.push(hashedPassword);
        }
        query += ' WHERE id = ?';
        params.push(id);

        await db.query(query, params);
        await logAction(username, 'UPDATE', 'USER', id, `Updated user: ${user.username}`);
        res.json({ id, ...user });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Error updating user' });
    }
});


app.put('/api/users/:id/profile', async (req, res) => {
    const { id } = req.params;
    const { realName, avatarUrl } = req.body;
    try {
        await db.query('UPDATE users SET realName = ?, avatarUrl = ? WHERE id = ?', [realName, avatarUrl, id]);
        
        // Fetch the updated user data to return
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found after update' });
        }
        const updatedUser = rows[0];
        const { password, twoFASecret, ...userResponse } = updatedUser;

        res.json(userResponse);
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Error updating user profile' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    try {
        const [rows] = await db.query('SELECT username FROM users WHERE id = ?', [id]);
        const deletedUsername = rows.length > 0 ? rows[0].username : `ID ${id}`;
        
        await db.query('DELETE FROM users WHERE id = ?', [id]);

        await logAction(username, 'DELETE', 'USER', id, `Deleted user: ${deletedUsername}`);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Error deleting user' });
    }
});

app.get('/api/audit-log', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 200');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching audit log:', error);
        res.status(500).json({ message: 'Error fetching audit log' });
    }
});

app.get('/api/approvals/pending', async (req, res) => {
    try {
        const [equipment] = await db.query("SELECT id, equipamento as name, 'equipment' as type FROM equipment WHERE approval_status = 'pending_approval'");
        const [licenses] = await db.query("SELECT id, CONCAT(produto, ' - ', usuario) as name, 'license' as type FROM licenses WHERE approval_status = 'pending_approval'");
        res.json([...equipment, ...licenses]);
    } catch (error) {
        console.error('Error fetching pending approvals:', error);
        res.status(500).json({ message: 'Error fetching pending approvals' });
    }
});

app.post('/api/approvals/approve', async (req, res) => {
    const { type, id, username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const table = type === 'equipment' ? 'equipment' : 'licenses';
        await connection.query(
            `UPDATE ${table} SET approval_status = 'approved' WHERE id = ?`,
            [id]
        );
        
        const itemNameResult = await connection.query(`SELECT ${type === 'equipment' ? 'equipamento' : 'produto'} as name FROM ${table} WHERE id = ?`, [id]);
        const itemName = itemNameResult[0][0]?.name || `ID ${id}`;

        await logAction(username, 'UPDATE', type.toUpperCase(), id, `Approved item: '${itemName}'`, connection);

        await connection.commit();
        res.json({ message: 'Item approved successfully' });
    } catch (error) {
        await connection.rollback();
        console.error(`Error approving item:`, error);
        res.status(500).json({ message: 'Error approving item' });
    } finally {
        connection.release();
    }
});

app.post('/api/approvals/reject', async (req, res) => {
    const { type, id, username, reason } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const table = type === 'equipment' ? 'equipment' : 'licenses';
        await connection.query(
            `UPDATE ${table} SET approval_status = 'rejected', rejection_reason = ? WHERE id = ?`,
            [reason, id]
        );
        
        const itemNameResult = await connection.query(`SELECT ${type === 'equipment' ? 'equipamento' : 'produto'} as name FROM ${table} WHERE id = ?`, [id]);
        const itemName = itemNameResult[0][0]?.name || `ID ${id}`;

        await logAction(username, 'UPDATE', type.toUpperCase(), id, `Rejected item '${itemName}'. Reason: ${reason}`, connection);

        await connection.commit();
        res.json({ message: 'Item rejected successfully' });
    } catch (error) {
        await connection.rollback();
        console.error(`Error rejecting item:`, error);
        res.status(500).json({ message: 'Error rejecting item' });
    } finally {
        connection.release();
    }
});

// 2FA Endpoints
app.post('/api/generate-2fa', async (req, res) => {
    const { userId } = req.body;
    try {
        const [rows] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const username = rows[0].username;

        const secret = authenticator.generateSecret();
        await db.query('UPDATE users SET twoFASecret = ? WHERE id = ?', [secret, userId]);

        const otpauth = authenticator.keyuri(username, 'InventarioPro', secret);
        res.json({ secret, qrCodeUrl: otpauth });
    } catch (error) {
        console.error('Error generating 2FA secret:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/enable-2fa', async (req, res) => {
    const { userId, token } = req.body;
    try {
        const [rows] = await db.query('SELECT twoFASecret, username FROM users WHERE id = ?', [userId]);
        if (rows.length === 0 || !rows[0].twoFASecret) {
            return res.status(400).json({ message: '2FA secret not found for user' });
        }
        const user = rows[0];
        const isValid = authenticator.verify({ token, secret: user.twoFASecret });

        if (isValid) {
            await db.query('UPDATE users SET is2FAEnabled = TRUE WHERE id = ?', [userId]);
            await logAction(user.username, '2FA_ENABLE', 'USER', userId, '2FA enabled successfully');
            res.status(200).json({ message: '2FA enabled successfully' });
        } else {
            res.status(401).json({ message: 'Invalid token' });
        }
    } catch (error) {
        console.error('Error enabling 2FA:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/disable-2fa', async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query('UPDATE users SET is2FAEnabled = FALSE, twoFASecret = NULL WHERE id = ?', [userId]);
        const [rows] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
        await logAction(rows[0].username, '2FA_DISABLE', 'USER', userId, '2FA disabled successfully');
        res.status(200).json({ message: '2FA disabled successfully' });
    } catch (error) {
        console.error('Error disabling 2FA:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/disable-user-2fa', async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query('UPDATE users SET is2FAEnabled = FALSE, twoFASecret = NULL WHERE id = ?', [userId]);
        res.status(200).json({ message: '2FA disabled for user successfully' });
    } catch (error) {
        console.error('Error disabling user 2FA:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Settings Endpoints
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM app_config");
        const settings = rows.reduce((acc, row) => {
            let value = row.config_value;
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (!isNaN(Number(value)) && Number.isInteger(parseFloat(value))) value = Number(value);
            acc[row.config_key] = value;
            return acc;
        }, {});
        res.json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ message: 'Error fetching settings' });
    }
});

app.post('/api/settings', async (req, res) => {
    const { settings, username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        for (const key in settings) {
            await connection.query(
                "INSERT INTO app_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?",
                [key, String(settings[key]), String(settings[key])]
            );
        }
        
        await logAction(username, 'SETTINGS_UPDATE', 'SETTINGS', null, `Updated system settings`, connection);
        
        await connection.commit();
        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error saving settings:', error);
        res.status(500).json({ message: 'Error saving settings' });
    } finally {
        connection.release();
    }
});


// Database Backup/Restore Endpoints
const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'inventario_pro_backup.sql');

const getTables = async () => {
    const [rows] = await db.query('SHOW TABLES');
    return rows.map(row => Object.values(row)[0]);
};

app.get('/api/database/backup-status', async (req, res) => {
    try {
        await fs.access(BACKUP_FILE);
        const stats = await fs.stat(BACKUP_FILE);
        res.json({ hasBackup: true, backupTimestamp: stats.mtime.toISOString() });
    } catch (error) {
        res.json({ hasBackup: false });
    }
});


app.post('/api/database/backup', async (req, res) => {
    const { username } = req.body;
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });

        const tables = await getTables();
        let dump = '';

        for (const table of tables) {
            if (table === 'migrations') continue;
            
            dump += `DROP TABLE IF EXISTS \`${table}\`;\n`;

            const [createTableResult] = await db.query(`SHOW CREATE TABLE \`${table}\``);
            dump += createTableResult[0]['Create Table'] + ';\n\n';

            const [rows] = await db.query(`SELECT * FROM \`${table}\``);
            if (rows.length > 0) {
                dump += `INSERT INTO \`${table}\` VALUES `;
                const values = rows.map(row => {
                    const rowValues = Object.values(row).map(val => {
                        if (val === null) return 'NULL';
                        return db.escape(val);
                    });
                    return `(${rowValues.join(',')})`;
                });
                dump += values.join(',\n') + ';\n\n';
            }
        }
        
        await fs.writeFile(BACKUP_FILE, dump);
        
        await logAction(username, 'UPDATE', 'SETTINGS', 'DATABASE', 'Database backup created.');

        res.json({ success: true, message: 'Backup created successfully.' });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, message: `Backup failed: ${error.message}` });
    }
});


app.post('/api/database/restore', async (req, res) => {
    const { username } = req.body;
    const connection = await db.getConnection();
    try {
        const dump = await fs.readFile(BACKUP_FILE, 'utf-8');

        await connection.query('SET foreign_key_checks = 0');
        const tables = await getTables();
        for (const table of tables) {
            if (table !== 'migrations') {
                await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
            }
        }
        
        // Execute the dump
        const queries = dump.split(';\n').filter(q => q.trim() !== '');
        for (const query of queries) {
            await connection.query(query);
        }
        
        await connection.query('SET foreign_key_checks = 1');
        
        await logAction(username, 'UPDATE', 'SETTINGS', 'DATABASE', 'Database restored from backup.');
        
        res.json({ success: true, message: 'Database restored successfully.' });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, message: `Restore failed: ${error.message}` });
    } finally {
        connection.release();
    }
});

app.post('/api/database/clear', async (req, res) => {
    const { username } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query('SET foreign_key_checks = 0');
        const tables = await getTables();
        for (const table of tables) {
            if (table !== 'migrations' && table !== 'users') {
                 await connection.query(`TRUNCATE TABLE \`${table}\``);
            }
        }
        // Special handling for users table to keep admin
        await connection.query('DELETE FROM users WHERE id != 1');
        
        // Reset migrations but keep the table
        await connection.query('TRUNCATE TABLE migrations');

        await connection.query('SET foreign_key_checks = 1');
        
        await logAction(username, 'DELETE', 'SETTINGS', 'DATABASE', 'Database cleared (reset).');

        await connection.commit();
        res.json({ success: true, message: 'Database cleared successfully. Please re-run migrations by restarting the server.' });
    } catch (error) {
        await connection.rollback();
        console.error('Clear DB error:', error);
        res.status(500).json({ success: false, message: `Clear DB failed: ${error.message}` });
    } finally {
        connection.release();
    }
});

app.get('/api/config/termo-templates', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT config_key, config_value FROM app_config WHERE config_key IN ('termo_entrega_template', 'termo_devolucao_template')");
        const templates = rows.reduce((acc, row) => {
            acc[row.config_key.replace('_template', 'Template')] = row.config_value;
            return acc;
        }, {});
        res.json(templates);
    } catch (error) {
        console.error('Error fetching termo templates:', error);
        res.status(500).json({ message: 'Error fetching termo templates' });
    }
});


const PORT = process.env.API_PORT || 3001;
initializeDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on port ${PORT}`);
    });
});