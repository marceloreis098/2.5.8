require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for photo uploads
app.use(express.urlencoded({ extended: true })); // Add this to parse form data from SAML IdP

const PORT = process.env.API_PORT || 3001;
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10');

// Database credentials from .env
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;

// Backup directory setup
const BACKUP_DIR = './backups';
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
}

// --- DATABASE CONNECTION & MIGRATIONS ---

const db = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true // Important for migrations
});

const runMigrations = async () => {
    console.log("Checking database migrations...");
    let connection;
    try {
        connection = await db.promise().getConnection();
        console.log("Database connection for migration successful.");

        // Migration table itself
        await connection.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INT PRIMARY KEY
            );
        `);

        const [executedRows] = await connection.query('SELECT id FROM migrations');
        const executedMigrationIds = new Set(executedRows.map((r) => r.id));

        const migrations = [
            {
                id: 1, sql: `
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    realName VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    role ENUM('Admin', 'User Manager', 'User') NOT NULL,
                    lastLogin DATETIME,
                    is2FAEnabled BOOLEAN DEFAULT FALSE,
                    twoFASecret VARCHAR(255),
                    ssoProvider VARCHAR(50) NULL,
                    avatarUrl MEDIUMTEXT
                );`
            },
            {
                id: 2, sql: `
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
                    dataEntregaUsuario VARCHAR(255),
                    status VARCHAR(255),
                    dataDevolucao VARCHAR(255),
                    tipo VARCHAR(255),
                    notaCompra VARCHAR(255),
                    notaPlKm VARCHAR(255),
                    termoResponsabilidade VARCHAR(255),
                    foto TEXT,
                    qrCode TEXT,
                    brand VARCHAR(255),
                    2FASecret VARCHAR(255),
                    model VARCHAR(255),
                    observacoes TEXT,
                    approval_status VARCHAR(50) DEFAULT 'approved',
                    rejection_reason TEXT
                );`
            },
            {
                id: 3, sql: `
                CREATE TABLE IF NOT EXISTS licenses (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    produto VARCHAR(255) NOT NULL,
                    tipoLicenca VARCHAR(255),
                    chaveSerial VARCHAR(255) NOT NULL,
                    dataExpiracao VARCHAR(255),
                    usuario VARCHAR(255) NOT NULL,
                    cargo VARCHAR(255),
                    setor VARCHAR(255),
                    gestor VARCHAR(255),
                    centroCusto VARCHAR(255),
                    contaRazao VARCHAR(255),
                    nomeComputador VARCHAR(255),
                    numeroChamado VARCHAR(255),
                    observacoes TEXT,
                    approval_status VARCHAR(50) DEFAULT 'approved',
                    rejection_reason TEXT
                );`
            },
            {
                id: 4, sql: `
                CREATE TABLE IF NOT EXISTS equipment_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    equipment_id INT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    changedBy VARCHAR(255),
                    changeType VARCHAR(255),
                    from_value TEXT,
                    to_value TEXT,
                    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
                );`
            },
            {
                id: 5, sql: `
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    username VARCHAR(255),
                    action_type VARCHAR(255),
                    target_type VARCHAR(255),
                    target_id VARCHAR(255),
                    details TEXT
                );`
            },
            {
                id: 6, sql: `
                CREATE TABLE IF NOT EXISTS app_config (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    config_key VARCHAR(255) NOT NULL UNIQUE,
                    config_value TEXT
                );`
            },
            {
                id: 7, sql: `INSERT IGNORE INTO users (username, realName, email, password, role) VALUES ('admin', 'Admin', 'admin@example.com', '${bcrypt.hashSync("marceloadmin", SALT_ROUNDS)}', 'Admin');`
            },
            {
                id: 8, sql: `
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('companyName', 'MRR INFORMATICA');
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('isSsoEnabled', 'false');
                `
            },
            { id: 9, sql: "ALTER TABLE equipment ADD COLUMN emailColaborador VARCHAR(255);" },
            { id: 10, sql: `
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('termo_entrega_template', NULL);
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('termo_devolucao_template', NULL);
            `},
            { id: 11, sql: "ALTER TABLE users ADD COLUMN avatarUrl MEDIUMTEXT;" },
            { id: 12, sql: "ALTER TABLE users MODIFY COLUMN avatarUrl MEDIUMTEXT;" },
            { id: 13, sql: "ALTER TABLE licenses ADD COLUMN created_by_id INT NULL;"}, // Add created_by_id for approval flow
            { id: 14, sql: "ALTER TABLE equipment ADD COLUMN created_by_id INT NULL;"}, // Add created_by_id for approval flow
            {
                id: 15, sql: `
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('is2faEnabled', 'false');
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('require2fa', 'false');
                `
            },
            { // Migration 16: Remove UNIQUE from patrimonio, make serial NOT NULL, remove 2FASecret from equipment
                id: 16, sql: `
                ALTER TABLE equipment DROP INDEX IF EXISTS patrimonio; -- Use IF EXISTS for robustness
                ALTER TABLE equipment MODIFY COLUMN patrimonio VARCHAR(255) NULL;
                ALTER TABLE equipment MODIFY COLUMN serial VARCHAR(255) NOT NULL;
                ALTER TABLE equipment DROP COLUMN IF EXISTS 2FASecret;
                `
            },
            { // Migration 17: Add new fields for detailed equipment information
                id: 17, sql: `
                ALTER TABLE equipment ADD COLUMN identificador VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN nomeSO VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN memoriaFisicaTotal VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN grupoPoliticas VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN pais VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN cidade VARCHAR(255) NULL;
                ALTER TABLE equipment ADD COLUMN estadoProvincia VARCHAR(255) NULL;
                `
            },
            { // Migration 18: Add field for responsibility agreement condition
                id: 18, sql: `
                ALTER TABLE equipment ADD COLUMN condicaoTermo VARCHAR(50) NULL;
                `
            },
            { // Migration 19: Set status to 'Em Uso' for equipment with a current user
                id: 19, sql: `
                UPDATE equipment SET status = 'Em Uso' WHERE usuarioAtual IS NOT NULL AND usuarioAtual != '';
                `
            },
            { // Migration 20: Add lastAbsoluteUpdateTimestamp to app_config
                id: 20, sql: `
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('lastAbsoluteUpdateTimestamp', NULL);
                `
            },
            { // Migration 21: Add hasInitialConsolidationRun to app_config
                id: 21, sql: `
                INSERT IGNORE INTO app_config (config_key, config_value) VALUES ('hasInitialConsolidationRun', 'false');
                `
            }
        ];
        
        const migrationsToRun = migrations.filter(m => !executedMigrationIds.has(m.id));

        if (migrationsToRun.length > 0) {
            console.log('New migrations to run:', migrationsToRun.map(m => m.id));
            await connection.beginTransaction();
            try {
                for (const migration of migrationsToRun) {
                    console.log(`Running migration ${migration.id}...`);
                    try {
                        await connection.query(migration.sql);
                    } catch (err) {
                        // MySQL error for duplicate column. MariaDB uses the same.
                        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_MULTIPLE_PRI_KEY' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
                            console.warn(`[MIGRATION WARN] Migration ${migration.id} failed because column/key already exists or cannot be dropped. Assuming it was applied. Marking as run.`);
                        } else {
                            // For other errors, we should fail loudly.
                            throw err;
                        }
                    }
                    await connection.query('INSERT INTO migrations (id) VALUES (?)', [migration.id]);
                }
                await connection.commit();
                console.log("All new migrations applied successfully.");
            } catch (err) {
                console.error("Error during migration, rolling back.", err);
                await connection.rollback();
                throw err; // Propagate error to stop server startup
            }
        } else {
            console.log("Database schema is up to date.");
        }
    } finally {
        if (connection) connection.release();
    }
};

const logAction = (username, action_type, target_type, target_id, details) => {
    const sql = "INSERT INTO audit_log (username, action_type, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [username, action_type, target_type, target_id, details], (err) => {
        if (err) console.error("Failed to log action:", err);
    });
};

const recordHistory = async (equipmentId, changedBy, changes) => {
    if (changes.length === 0) return;
    const conn = await db.promise().getConnection();
    try {
        await conn.beginTransaction();
        for (const change of changes) {
            const { field, oldValue, newValue } = change;
            await conn.query(
                'INSERT INTO equipment_history (equipment_id, changedBy, changeType, from_value, to_value) VALUES (?, ?, ?, ?, ?)',
                [equipmentId, changedBy, field, oldValue, newValue]
            );
        }
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        console.error("Failed to record history:", error);
    } finally {
        conn.release();
    }
};


// Middleware to check Admin role
const isAdmin = async (req, res, next) => {
    const username = req.body.username || req.query.username; // Allow username from query for GET requests if needed
    if (!username) return res.status(401).json({ message: "Authentication required" });

    try {
        const [rows] = await db.promise().query('SELECT role FROM users WHERE username = ?', [username]);
        if (rows.length === 0 || rows[0].role !== 'Admin') {
            return res.status(403).json({ message: "Access denied. Admin privileges required." });
        }
        req.userRole = rows[0].role;
        next();
    } catch (error) {
        console.error("Error checking admin role:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

// --- API ENDPOINTS ---

// GET / - Health Check
app.get('/api', (req, res) => {
    res.json({ message: "Inventario Pro API is running!" });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, ssoToken } = req.body;

        if (ssoToken) {
            // This is a placeholder for a real SSO token validation logic
            // In a real scenario, you'd verify the token with the IdP's public key
            // and extract user information from it.
            return res.status(501).json({ message: "SSO token validation not implemented." });
        }

        // Standard Login
        const [results] = await db.promise().query("SELECT * FROM users WHERE username = ?", [username]);

        if (results.length > 0) {
            const user = results[0];
            const passwordIsValid = bcrypt.compareSync(password, user.password);

            if (passwordIsValid) {
                const [settingsRows] = await db.promise().query("SELECT config_key, config_value FROM app_config WHERE config_key IN ('is2faEnabled', 'require2fa')");
                const settings = settingsRows.reduce((acc, row) => {
                    acc[row.config_key] = row.config_value === 'true';
                    return acc;
                }, {});

                if (settings.is2faEnabled && settings.require2fa && !user.is2FAEnabled && user.username !== 'admin' && !user.ssoProvider) {
                    logAction(username, 'LOGIN_SUCCESS', 'USER', user.id, 'User requires 2FA setup.');
                    const userResponse = { ...user, requires2FASetup: true };
                    delete userResponse.password;
                    delete userResponse.twoFASecret;
                    return res.json(userResponse);
                }

                await db.promise().query("UPDATE users SET lastLogin = NOW() WHERE id = ?", [user.id]);
                logAction(username, 'LOGIN', 'USER', user.id, 'User logged in successfully');

                const userResponse = { ...user };
                delete userResponse.password;
                delete userResponse.twoFASecret;

                res.json(userResponse);
            } else {
                res.status(401).json({ message: "Usuário ou senha inválidos" });
            }
        } else {
            res.status(401).json({ message: "Usuário ou senha inválidos" });
        }
    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ message: "Erro de banco de dados durante o login." });
    }
});

// GET /api/sso/login - Initiates the SAML Single Sign-On flow
app.get('/api/sso/login', async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT config_key, config_value FROM app_config WHERE config_key IN ('isSsoEnabled', 'ssoUrl', 'ssoEntityId')");
        const settings = rows.reduce((acc, row) => {
            acc[row.config_key] = row.config_value;
            return acc;
        }, {});
        
        if (settings.isSsoEnabled !== 'true' || !settings.ssoUrl) {
            return res.status(400).send('<h1>Erro de Configuração</h1><p>O Login SSO não está habilitado ou a URL do SSO não foi configurada. Por favor, contate o administrador.</p>');
        }
        
        const frontendHost = req.hostname;
        const acsUrl = `http://${frontendHost}:3001/api/sso/callback`;
        const entityId = settings.ssoEntityId || `http://${frontendHost}:3000`;
        const requestId = '_' + crypto.randomBytes(20).toString('hex');
        const issueInstant = new Date().toISOString();

        const samlRequestXml = `
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                    ID="${requestId}"
                    Version="2.0"
                    IssueInstant="${issueInstant}"
                    Destination="${settings.ssoUrl}"
                    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                    AssertionConsumerServiceURL="${acsUrl}">
  <saml:Issuer>${entityId}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"
                      AllowCreate="true" />
</samlp:AuthnRequest>
        `.trim();

        zlib.deflateRaw(Buffer.from(samlRequestXml), (err, compressed) => {
            if (err) {
                console.error("SAML request compression failed:", err);
                return res.status(500).send("Falha ao construir a solicitação SAML.");
            }
            const samlRequest = compressed.toString('base64');
            const redirectUrl = `${settings.ssoUrl}?SAMLRequest=${encodeURIComponent(samlRequest)}`;
            res.redirect(redirectUrl);
        });
    } catch (error) {
        console.error("Error during SSO login initiation:", error);
        res.status(500).send("Erro interno do servidor durante o login SSO.");
    }
});

app.post('/api/sso/callback', (req, res) => {
    // This is a placeholder for handling the SAML response from the IdP
    // A real implementation would require a SAML library to parse and verify the response.
    console.log('Received SAML Response:', req.body.SAMLResponse);
    res.redirect(`http://${req.hostname}:3000?sso_token=dummy_token_for_now`);
});

// POST /api/verify-2fa
app.post('/api/verify-2fa', (req, res) => {
    const { userId, token } = req.body;
    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ message: 'User not found' });
        const user = results[0];
        const isValid = authenticator.check(token, user.twoFASecret);
        if (isValid) {
            const userResponse = { ...user };
            delete userResponse.password;
            delete userResponse.twoFASecret;
            res.json(userResponse);
        } else {
            res.status(401).json({ message: 'Código de verificação inválido' });
        }
    });
});


// GET /api/equipment
app.get('/api/equipment', (req, res) => {
    const { userId, role } = req.query;
    let sql = "SELECT * FROM equipment ORDER BY equipamento ASC";
    let params = [];

    if (role !== 'Admin' && role !== 'User Manager') {
        sql = `
            SELECT * FROM equipment 
            WHERE approval_status = 'approved' OR (created_by_id = ? AND approval_status != 'approved')
            ORDER BY equipamento ASC
        `;
        params = [userId];
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        res.json(results);
    });
});

app.get('/api/equipment/:id/history', (req, res) => {
    const { id } = req.params;
    const sql = "SELECT * FROM equipment_history WHERE equipment_id = ? ORDER BY timestamp DESC";
    db.query(sql, [id], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        res.json(results);
    });
});

app.post('/api/equipment', async (req, res) => {
    const { equipment, username } = req.body;
    const { id, qrCode, ...newEquipment } = equipment;

    try {
        const [userRows] = await db.promise().query('SELECT id, role FROM users WHERE username = ?', [username]);
        if (userRows.length === 0) return res.status(404).json({ message: "User not found" });
        const user = userRows[0];

        const [serialCheck] = await db.promise().query('SELECT id FROM equipment WHERE serial = ?', [newEquipment.serial]);
        if (serialCheck.length > 0) {
            return res.status(409).json({ message: "Erro: O número de série já está cadastrado no sistema." });
        }

        newEquipment.created_by_id = user.id;
        newEquipment.approval_status = user.role === 'Admin' ? 'approved' : 'pending_approval';
        
        const sql = "INSERT INTO equipment SET ?";
        const [result] = await db.promise().query(sql, newEquipment);
        
        const insertedId = result.insertId;
        const qrCodeValue = JSON.stringify({ id: insertedId, serial: newEquipment.serial, type: 'equipment' });
        await db.promise().query('UPDATE equipment SET qrCode = ? WHERE id = ?', [qrCodeValue, insertedId]);
        
        logAction(username, 'CREATE', 'EQUIPMENT', insertedId, `Created new equipment: ${newEquipment.equipamento}`);
        
        const [insertedRow] = await db.promise().query('SELECT * FROM equipment WHERE id = ?', [insertedId]);
        res.status(201).json(insertedRow[0]);
    } catch (err) {
        console.error("Add equipment error:", err);
        res.status(500).json({ message: "Database error", error: err });
    }
});

app.put('/api/equipment/:id', async (req, res) => {
    const { id } = req.params;
    const { equipment, username } = req.body;

    try {
        const [oldEquipmentRows] = await db.promise().query('SELECT * FROM equipment WHERE id = ?', [id]);
        if (oldEquipmentRows.length === 0) return res.status(404).json({ message: "Equipment not found" });
        const oldEquipment = oldEquipmentRows[0];

        const changes = Object.keys(equipment).reduce((acc, key) => {
            const oldValue = oldEquipment[key] instanceof Date ? oldEquipment[key].toISOString().split('T')[0] : oldEquipment[key];
            const newValue = equipment[key];
            if (String(oldValue || '') !== String(newValue || '')) {
                acc.push({ field: key, oldValue, newValue });
            }
            return acc;
        }, []);

        // Re-generate QR code if serial changes
        if(equipment.serial && equipment.serial !== oldEquipment.serial) {
            equipment.qrCode = JSON.stringify({ id: equipment.id, serial: equipment.serial, type: 'equipment' });
        }

        const sql = "UPDATE equipment SET ? WHERE id = ?";
        await db.promise().query(sql, [equipment, id]);
        
        if (changes.length > 0) {
            await recordHistory(id, username, changes);
            logAction(username, 'UPDATE', 'EQUIPMENT', id, `Updated equipment: ${equipment.equipamento}. Changes: ${changes.map(c => c.field).join(', ')}`);
        }
        
        res.json({ ...equipment, id: parseInt(id) });
    } catch (err) {
        console.error("Update equipment error:", err);
        res.status(500).json({ message: "Database error", error: err });
    }
});

app.delete('/api/equipment/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    db.query("SELECT equipamento FROM equipment WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length > 0) {
            const equipName = results[0].equipamento;
            db.query("DELETE FROM equipment WHERE id = ?", [id], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ message: "Database error", error: deleteErr });
                logAction(username, 'DELETE', 'EQUIPMENT', id, `Deleted equipment: ${equipName}`);
                res.status(204).send();
            });
        } else {
            res.status(404).json({ message: "Equipment not found" });
        }
    });
});

app.post('/api/equipment/import', isAdmin, async (req, res) => {
    const { equipmentList, username } = req.body;
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM equipment_history');
        await connection.query('DELETE FROM equipment');
        await connection.query('ALTER TABLE equipment AUTO_INCREMENT = 1');
        
        for (const equipment of equipmentList) {
            const { id, ...newEquipment } = equipment;
            const [result] = await connection.query('INSERT INTO equipment SET ?', [newEquipment]);
            const insertedId = result.insertId;
            const qrCodeValue = JSON.stringify({ id: insertedId, serial: newEquipment.serial, type: 'equipment' });
            await connection.query('UPDATE equipment SET qrCode = ? WHERE id = ?', [qrCodeValue, insertedId]);
        }

        await connection.query(
            "INSERT INTO app_config (config_key, config_value) VALUES ('lastAbsoluteUpdateTimestamp', ?) ON DUPLICATE KEY UPDATE config_value = ?",
            [new Date().toISOString(), new Date().toISOString()]
        );
        await connection.query(
            "INSERT INTO app_config (config_key, config_value) VALUES ('hasInitialConsolidationRun', ?) ON DUPLICATE KEY UPDATE config_value = ?",
            ['true', 'true']
        );

        await connection.commit();
        logAction(username, 'IMPORT', 'EQUIPMENT', 'ALL', `Replaced entire equipment inventory with ${equipmentList.length} items via initial consolidation tool.`);
        res.json({ success: true, message: 'Inventário de equipamentos importado com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error("Equipment import error:", err);
        res.status(500).json({ success: false, message: `Erro de banco de dados durante a importação: ${err.message}` });
    } finally {
        connection.release();
    }
});

app.post('/api/equipment/periodic-update', isAdmin, async (req, res) => {
    const { equipmentList, username } = req.body;
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        
        for (const equipmentData of equipmentList) {
            const serial = equipmentData.serial;
            if (!serial) {
                console.warn(`Skipping equipment item due to missing serial:`, equipmentData);
                continue;
            }

            const [existingEquipmentRows] = await connection.query('SELECT * FROM equipment WHERE serial = ?', [serial]);
            const existingEquipment = existingEquipmentRows[0];

            let changes = [];
            const fieldsToUpdate = [
                'equipamento', 'usuarioAtual', 'brand', 'model', 'emailColaborador',
                'identificador', 'nomeSO', 'memoriaFisicaTotal', 'grupoPoliticas',
                'pais', 'cidade', 'estadoProvincia'
            ];
            
            // Determine status based on usuarioAtual from Absolute data
            let newStatus = existingEquipment ? existingEquipment.status : 'Estoque'; // Default for new or if no change
            if (equipmentData.usuarioAtual && equipmentData.usuarioAtual.trim() !== '') {
                newStatus = 'Em Uso';
            } else if (equipmentData.usuarioAtual === '' || equipmentData.usuarioAtual === null) {
                newStatus = 'Estoque';
            }
            if (existingEquipment && existingEquipment.status !== newStatus) {
                changes.push({ field: 'status', oldValue: existingEquipment.status, newValue: newStatus });
            }
            equipmentData.status = newStatus; // Apply to current equipmentData for DB update

            if (existingEquipment) {
                // Update existing equipment
                const updateFields = {};
                fieldsToUpdate.forEach(field => {
                    const newValue = equipmentData[field];
                    const oldValue = existingEquipment[field];
                    if (String(oldValue || '') !== String(newValue || '')) {
                        updateFields[field] = newValue;
                        changes.push({ field, oldValue: oldValue || '', newValue: newValue || '' });
                    }
                });

                if (Object.keys(updateFields).length > 0 || changes.some(c => c.field === 'status')) {
                    await connection.query('UPDATE equipment SET ?, status = ? WHERE id = ?', [updateFields, newStatus, existingEquipment.id]);
                    await recordHistory(existingEquipment.id, username, changes);
                    logAction(username, 'UPDATE', 'EQUIPMENT', existingEquipment.id, `Periodic update: ${existingEquipment.equipamento}. Changes: ${changes.map(c => c.field).join(', ')}`);
                }
            } else {
                // Insert new equipment
                const newEquipment = {
                    ...equipmentData,
                    approval_status: 'approved', // Always approved for periodic updates
                    created_by_id: (await connection.query('SELECT id FROM users WHERE username = ?', [username]))[0][0].id,
                    qrCode: JSON.stringify({ id: null, serial: equipmentData.serial, type: 'equipment' }) // Temporary QR, will be updated
                };
                const [insertResult] = await connection.query('INSERT INTO equipment SET ?', [newEquipment]);
                const insertedId = insertResult.insertId;
                const qrCodeValue = JSON.stringify({ id: insertedId, serial: newEquipment.serial, type: 'equipment' });
                await connection.query('UPDATE equipment SET qrCode = ? WHERE id = ?', [qrCodeValue, insertedId]);
                await recordHistory(insertedId, username, [{ field: 'initial_import', oldValue: 'N/A', newValue: 'Imported via periodic update' }]);
                logAction(username, 'CREATE', 'EQUIPMENT', insertedId, `Periodic update: New equipment added: ${equipmentData.equipamento}`);
            }
        }

        await connection.query(
            "INSERT INTO app_config (config_key, config_value) VALUES ('lastAbsoluteUpdateTimestamp', ?) ON DUPLICATE KEY UPDATE config_value = ?",
            [new Date().toISOString(), new Date().toISOString()]
        );

        await connection.commit();
        logAction(username, 'IMPORT', 'EQUIPMENT', 'PARTIAL', `Periodic update of equipment inventory with ${equipmentList.length} items from Absolute report.`);
        res.json({ success: true, message: 'Inventário de equipamentos atualizado periodicamente com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error("Periodic equipment update error:", err);
        res.status(500).json({ success: false, message: `Erro de banco de dados durante a atualização: ${err.message}` });
    } finally {
        connection.release();
    }
});


// --- LICENSES ---
app.get('/api/licenses', (req, res) => {
    const { userId, role } = req.query;
    let sql = "SELECT * FROM licenses ORDER BY produto, usuario ASC";
    let params = [];

    if (role !== 'Admin') {
        sql = `
            SELECT * FROM licenses 
            WHERE approval_status = 'approved' OR (created_by_id = ? AND approval_status != 'approved')
            ORDER BY produto, usuario ASC
        `;
        params = [userId];
    }
    
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        res.json(results);
    });
});

app.post('/api/licenses', async (req, res) => {
    const { license, username } = req.body;
    const { id, ...newLicense } = license;

    try {
        const [userRows] = await db.promise().query('SELECT id, role FROM users WHERE username = ?', [username]);
        if (userRows.length === 0) return res.status(404).json({ message: "User not found" });
        const user = userRows[0];
        
        newLicense.created_by_id = user.id;
        newLicense.approval_status = user.role === 'Admin' ? 'approved' : 'pending_approval';

        const sql = "INSERT INTO licenses SET ?";
        const [result] = await db.promise().query(sql, newLicense);
        
        logAction(username, 'CREATE', 'LICENSE', result.insertId, `Created new license for product: ${newLicense.produto}`);
        const [insertedRow] = await db.promise().query('SELECT * FROM licenses WHERE id = ?', [result.insertId]);
        res.status(201).json(insertedRow[0]);
    } catch (err) {
        console.error("Add license error:", err);
        res.status(500).json({ message: "Database error", error: err });
    }
});

app.put('/api/licenses/:id', (req, res) => {
    const { id } = req.params;
    const { license, username } = req.body;
    db.query("UPDATE licenses SET ? WHERE id = ?", [license, id], (err) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        logAction(username, 'UPDATE', 'LICENSE', id, `Updated license for product: ${license.produto}`);
        res.json({ ...license, id: parseInt(id) });
    });
});

app.delete('/api/licenses/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    db.query("SELECT produto FROM licenses WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length > 0) {
            const productName = results[0].produto;
            db.query("DELETE FROM licenses WHERE id = ?", [id], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ message: "Database error", error: deleteErr });
                logAction(username, 'DELETE', 'LICENSE', id, `Deleted license for product: ${productName}`);
                res.status(204).send();
            });
        } else {
            res.status(404).json({ message: "License not found" });
        }
    });
});

app.post('/api/licenses/import', isAdmin, async (req, res) => {
    const { productName, licenses, username } = req.body;
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM licenses WHERE produto = ?', [productName]);

        if (licenses && licenses.length > 0) {
            const sql = "INSERT INTO licenses (produto, tipoLicenca, chaveSerial, dataExpiracao, usuario, cargo, setor, gestor, centroCusto, contaRazao, nomeComputador, numeroChamado, observacoes, approval_status) VALUES ?";
            const values = licenses.map(l => [
                productName, l.tipoLicenca, l.chaveSerial, l.dataExpiracao, l.usuario, l.cargo, l.setor,
                l.gestor, l.centroCusto, l.contaRazao, l.nomeComputador, l.numeroChamado, l.observacoes, 'approved'
            ]);
            await connection.query(sql, [values]);
        }
        
        await connection.commit();
        logAction(username, 'IMPORT', 'LICENSE', productName, `Replaced all licenses for product ${productName} with ${licenses.length} new items via CSV import.`);
        res.json({ success: true, message: `Licenças para ${productName} importadas com sucesso.` });
    } catch (err) {
        await connection.rollback();
        console.error("License import error:", err);
        res.status(500).json({ success: false, message: `Erro de banco de dados: ${err.message}` });
    } finally {
        connection.release();
    }
});


// --- LICENSE TOTALS & PRODUCT MANAGEMENT ---
app.get('/api/licenses/totals', async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT config_value FROM app_config WHERE config_key = 'license_totals'");
        if (rows.length > 0 && rows[0].config_value) {
            res.json(JSON.parse(rows[0].config_value));
        } else {
            res.json({}); // Return empty object if not found
        }
    } catch (err) {
        console.error("Get license totals error:", err);
        res.status(500).json({});
    }
});

app.post('/api/licenses/totals', isAdmin, async (req, res) => {
    const { totals, username } = req.body;
    try {
        const totalsJson = JSON.stringify(totals);
        await db.promise().query(
            "INSERT INTO app_config (config_key, config_value) VALUES ('license_totals', ?) ON DUPLICATE KEY UPDATE config_value = ?",
            [totalsJson, totalsJson]
        );
        logAction(username, 'UPDATE', 'TOTALS', null, 'Updated license totals');
        res.json({ success: true, message: 'Totais de licenças salvos com sucesso.' });
    } catch (err) {
        console.error("Save license totals error:", err);
        res.status(500).json({ success: false, message: 'Erro ao salvar totais de licenças.' });
    }
});

app.post('/api/licenses/rename-product', isAdmin, async (req, res) => {
    const { oldName, newName, username } = req.body;
    try {
        await db.promise().query("UPDATE licenses SET produto = ? WHERE produto = ?", [newName, oldName]);
        logAction(username, 'UPDATE', 'PRODUCT', oldName, `Renamed product from ${oldName} to ${newName}`);
        res.status(204).send();
    } catch (err) {
        console.error("Rename product error:", err);
        res.status(500).json({ message: 'Failed to rename product' });
    }
});

// --- USERS ---
app.get('/api/users', (req, res) => {
    db.query("SELECT id, username, realName, email, role, lastLogin, is2FAEnabled, ssoProvider, avatarUrl FROM users", (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        res.json(results);
    });
});

app.post('/api/users', (req, res) => {
    const { user, username } = req.body;
    user.password = bcrypt.hashSync(user.password, SALT_ROUNDS);
    db.query("INSERT INTO users SET ?", user, (err, result) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        logAction(username, 'CREATE', 'USER', result.insertId, `Created new user: ${user.username}`);
        res.status(201).json({ id: result.insertId, ...user });
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { user, username } = req.body;
    if (user.password) {
        user.password = bcrypt.hashSync(user.password, SALT_ROUNDS);
    } else {
        delete user.password;
    }
    db.query("UPDATE users SET ? WHERE id = ?", [user, id], (err) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        logAction(username, 'UPDATE', 'USER', id, `Updated user: ${user.username}`);
        res.json(user);
    });
});

app.put('/api/users/:id/profile', (req, res) => {
    const { id } = req.params;
    const { realName, avatarUrl } = req.body;
    db.query("UPDATE users SET realName = ?, avatarUrl = ? WHERE id = ?", [realName, avatarUrl, id], (err) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        db.query("SELECT id, username, realName, email, role, lastLogin, is2FAEnabled, ssoProvider, avatarUrl FROM users WHERE id = ?", [id], (selectErr, results) => {
            if (selectErr || results.length === 0) return res.status(500).json({ message: "Failed to fetch updated user data" });
            res.json(results[0]);
        });
    });
});


app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    db.query("SELECT username FROM users WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length > 0) {
            const deletedUsername = results[0].username;
            db.query("DELETE FROM users WHERE id = ?", [id], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ message: "Database error", error: deleteErr });
                logAction(username, 'DELETE', 'USER', id, `Deleted user: ${deletedUsername}`);
                res.status(204).send();
            });
        }
    });
});

// --- AUDIT LOG ---
app.get('/api/audit-log', (req, res) => {
    db.query("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 500", (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        res.json(results);
    });
});

// --- APPROVALS ---
app.get('/api/approvals/pending', async (req, res) => {
    try {
        const [equipment] = await db.promise().query("SELECT id, equipamento as name, 'equipment' as type FROM equipment WHERE approval_status = 'pending_approval'");
        const [licenses] = await db.promise().query("SELECT id, CONCAT(produto, ' - ', usuario) as name, 'license' as type FROM licenses WHERE approval_status = 'pending_approval'");
        res.json([...equipment, ...licenses]);
    }}<\content>
</change>
<change>
<file>components/Dashboard.tsx</file>
<description>Atualiza o componente Dashboard para exibir o status da consolidação inicial e da atualização periódica, com mensagens e botões de navegação adequados.</description>
<content><![CDATA[import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { getEquipment, getLicenses, getSettings } from '../services/apiService';
import { Equipment, License, Page, User, UserRole } from '../types';
import Icon from './common/Icon';

const ApprovalQueue = lazy(() => import('./ApprovalQueue'));

interface DashboardProps {
    setActivePage: (page: Page) => void;
    currentUser: User;
}

const PIE_COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#e74c3c', '#9b59b6', '#1abc9c', '#d35400'];

const Dashboard: React.FC<DashboardProps> = ({setActivePage, currentUser}) => {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastAbsoluteUpdateTimestamp, setLastAbsoluteUpdateTimestamp] = useState<string | null>(null);
  const [hasInitialConsolidationRun, setHasInitialConsolidationRun] = useState<boolean>(false);
  const [isUpdateRequired, setIsUpdateRequired] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [equipmentData, licensesData, settingsData] = await Promise.all([
        getEquipment(currentUser),
        getLicenses(currentUser),
        getSettings(),
      ]);
      setEquipment(equipmentData);
      setLicenses(licensesData);
      
      setHasInitialConsolidationRun(settingsData.hasInitialConsolidationRun || false);

      if (settingsData.lastAbsoluteUpdateTimestamp) {
          setLastAbsoluteUpdateTimestamp(settingsData.lastAbsoluteUpdateTimestamp);
          const lastUpdate = new Date(settingsData.lastAbsoluteUpdateTimestamp);
          const now = new Date();
          const hoursDiff = Math.abs(now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
          setIsUpdateRequired(hoursDiff > 48);
      } else {
          setLastAbsoluteUpdateTimestamp(null);
          setIsUpdateRequired(true); // If no timestamp, assume update is required
      }

    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUser]);

  const isDarkMode = document.documentElement.classList.contains('dark');
  const textColor = isDarkMode ? '#edf2f7' : '#333';
  const tooltipBackgroundColor = isDarkMode ? '#2d3748' : '#ffffff';
  const tooltipBorderColor = isDarkMode ? '#4a5568' : '#cccccc';
  
  // Stats calculation
  const totalEquipment = equipment.length;
  const statusCounts = equipment.reduce((acc, item) => {
      const status = (item.status || 'Indefinido').toUpperCase();
      acc[status] = (acc[status] || 0) + 1;
      return acc;
  }, {} as {[key: string]: number});
  
  const expiringLicenses = licenses.filter(l => {
      if (!l.dataExpiracao || l.dataExpiracao === 'N/A') return false;
      const expDate = new Date(l.dataExpiracao);
      const today = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      return expDate > today && expDate <= thirtyDaysFromNow;
  }).length;


  const brandData = equipment.reduce((acc, item) => {
    const brandName = item.brand || 'Não especificado';
    const existingBrand = acc.find(d => d.name === brandName);
    if (existingBrand) {
      existingBrand.value += 1;
    } else {
      acc.push({ name: brandName, value: 1 });
    }
    return acc;
  }, [] as { name: string, value: number }[]).sort((a,b) => a.value - b.value);

  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));


  const StatCard = ({ icon, title, value, color, onClick }: { icon: any, title: string, value: string | number, color: string, onClick?: () => void }) => (
    <div className={`bg-white dark:bg-dark-card p-6 rounded-lg shadow-md flex items-center ${onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`} onClick={onClick}>
      <div className={`p-4 rounded-full ${color}`}>
        <Icon name={icon} size={24} className="text-white" />
      </div>
      <div className="ml-4">
        <p className="text-lg font-semibold text-gray-700 dark:text-dark-text-secondary">{title}</p>
        <p className="text-3xl font-bold text-gray-900 dark:text-dark-text-primary">{value}</p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Icon name="LoaderCircle" className="animate-spin text-brand-primary" size={48} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
       {currentUser.role === UserRole.Admin && (
          <Suspense fallback={<div>Carregando...</div>}>
            <ApprovalQueue currentUser={currentUser} onAction={fetchData} />
          </Suspense>
       )}
      <h2 className="text-3xl font-bold text-brand-dark dark:text-dark-text-primary">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon="Computer" title="Total de Itens" value={totalEquipment} color="bg-blue-500" onClick={() => setActivePage('Inventário de Equipamentos')} />
        <StatCard icon="Play" title="Em Uso" value={statusCounts['EM USO'] || 0} color="bg-status-active"/>
        <StatCard icon="Archive" title="Estoque" value={statusCounts['ESTOQUE'] || 0} color="bg-yellow-500" />
        <StatCard icon="Timer" title="Licenças Expirando" value={expiringLicenses} color="bg-red-500" onClick={() => setActivePage('Controle de Licenças')} />
      </div>

      {currentUser.role === UserRole.Admin && (
            <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md mt-6">
                <h3 className="text-xl font-semibold mb-4 text-brand-dark dark:text-dark-text-primary flex items-center gap-2">
                    <Icon name="RefreshCcw" size={20} />
                    Status da Atualização do Inventário
                </h3>
                {!hasInitialConsolidationRun ? (
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-300 rounded-md text-sm flex items-start gap-2">
                        <Icon name="Info" size={18} className="flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Consolidação inicial pendente!</p>
                            <p className="mt-1">A ferramenta de consolidação de inventário ainda não foi utilizada. Complete a primeira importação para ativar as atualizações periódicas e o acompanhamento.</p>
                            <button
                                onClick={() => setActivePage('Configurações')}
                                className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
                            >
                                <Icon name="UploadCloud" size={16} />
                                Ir para Importações
                            </button>
                        </div>
                    </div>
                ) : (
                    lastAbsoluteUpdateTimestamp ? (
                        <div className="space-y-3">
                            <p className="text-gray-700 dark:text-dark-text-secondary">
                                Última atualização periódica do inventário: {' '}
                                <span className="font-bold">{new Date(lastAbsoluteUpdateTimestamp).toLocaleString('pt-BR')}</span>
                            </p>
                            {isUpdateRequired && (
                                <div className="bg-orange-100 dark:bg-orange-900/20 border-l-4 border-orange-500 text-orange-700 dark:text-orange-300 p-3 rounded-md flex items-start gap-2 animate-fade-in">
                                    <Icon name="AlertTriangle" size={20} className="flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-semibold">Atualização pendente!</p>
                                        <p className="text-sm">Mais de 48 horas se passaram desde a última atualização periódica do inventário. Recomenda-se realizar uma nova atualização.</p>
                                        <button
                                            onClick={() => setActivePage('Configurações')}
                                            className="mt-3 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 flex items-center gap-2 text-sm"
                                        >
                                            <Icon name="UploadCloud" size={16} />
                                            Ir para Importações
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-300 rounded-md text-sm flex items-start gap-2">
                            <Icon name="Info" size={18} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-semibold">Nenhuma atualização periódica registrada.</p>
                                <p className="mt-1">Realize a primeira atualização periódica de dados para ativar o acompanhamento.</p>
                                <button
                                    onClick={() => setActivePage('Configurações')}
                                    className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
                                >
                                    <Icon name="UploadCloud" size={16} />
                                    Ir para Importações
                                </button>
                            </div>
                        </div>
                    )
                )}
            </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-brand-dark dark:text-dark-text-primary">Equipamentos por Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusData}>
              <XAxis dataKey="name" stroke={textColor} />
              <YAxis stroke={textColor} allowDecimals={false}/>
              <Tooltip cursor={{fill: 'rgba(128,128,128,0.1)'}} contentStyle={{ backgroundColor: tooltipBackgroundColor, borderColor: tooltipBorderColor }}/>
              <Legend wrapperStyle={{ color: textColor }} />
              <Bar dataKey="value" name="Total" fill="#8884d8">
                 {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-brand-dark dark:text-dark-text-primary">Equipamentos por Marca</h3>
          <ResponsiveContainer width="100%" height={300}>
             <BarChart layout="vertical" data={brandData} margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#4a5568' : '#e0e0e0'}/>
                <XAxis type="number" stroke={textColor} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke={textColor} width={80} tick={{ fontSize: 12, fill: textColor }} />
                <Tooltip cursor={{fill: 'rgba(128,128,128,0.1)'}} contentStyle={{ backgroundColor: tooltipBackgroundColor, borderColor: tooltipBorderColor }}/>
                <Bar dataKey="value" name="Quantidade" fill="#3498db" barSize={20}>
                    {brandData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;]]></content>
</change>
<change>
<file>components/Settings.tsx</file>
<description>
      Atualiza o componente de Configurações para gerenciar o estado e a renderização condicional
      da ferramenta de consolidação inicial (`DataConsolidation`) e da nova ferramenta de
      atualização periódica (`PeriodicAbsoluteUpdate`) com base na configuração `hasInitialConsolidationRun`.
      Também garante que `hasInitialConsolidationRun` seja carregado e passado para as ferramentas.
    </description>
<content><![CDATA[import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, AppSettings, License } from '../types';
import Icon from './common/Icon';
import { getSettings, saveSettings, checkApiStatus, checkDatabaseBackupStatus, backupDatabase, restoreDatabase, clearDatabase, getLicenseTotals, getLicenses } from '../services/apiService';
import DataConsolidation from './DataConsolidation'; // Original consolidation tool
import LicenseImport from './LicenseImport';
import PeriodicAbsoluteUpdate from './PeriodicAbsoluteUpdate'; // Novo componente para atualização periódica

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
        hasInitialConsolidationRun: false, // Initialize new setting
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
                    hasInitialConsolidationRun: data.hasInitialConsolidationRun || false, // Load new setting
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
            const result = await saveSettings(finalSettings as AppSettings, currentUser.username);
            // Update local state for hasInitialConsolidationRun if returned by API
            if (typeof result.hasInitialConsolidationRun === 'boolean') {
                setSettings(prev => ({ ...prev, hasInitialConsolidationRun: result.hasInitialConsolidationRun }));
            }
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
                        <div className="animate-fade-in">
                            <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary mb-4">Gerenciamento de Importações</h3>
                            
                            {!settings.hasInitialConsolidationRun ? (
                                <>
                                    <p className="text-lg font-semibold text-gray-700 dark:text-dark-text-secondary mb-4">
                                        Ferramenta de Consolidação Inicial do Inventário
                                    </p>
                                    <DataConsolidation currentUser={currentUser} />
                                </>
                            ) : (
                                <>
                                    <p className="text-lg font-semibold text-gray-700 dark:text-dark-text-secondary mb-4">
                                        Atualização Periódica de Equipamentos (Relatório Absolute)
                                    </p>
                                    <PeriodicAbsoluteUpdate currentUser={currentUser} onUpdateSuccess={fetchAllData} />
                                </>
                            )}
                            
                            <div className="mt-8">
                                <p className="text-lg font-semibold text-gray-700 dark:text-dark-text-secondary mb-4">
                                    Importação de Licenças
                                </p>
                                <LicenseImport 
                                    currentUser={currentUser} 
                                    productNames={productNames} 
                                    onImportSuccess={fetchAllData}
                                />
                            </div>
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

export default Settings;]]></content>
</change>
<change>
<file>components/DataConsolidation.tsx</file>
<description>
      Ajusta a lógica de `parseCsv` para padronizar as chaves de cabeçalho e lidar com valores vazios de usuário,
      garantindo que o `status` seja definido corretamente para 'Em Uso' ou 'Estoque' durante a consolidação.
      Remove a mensagem de aviso de substituição total para que o componente `Settings` controle a renderização e o contexto da ferramenta.
    </description>
<content><![CDATA[import React, { useState, useRef, useMemo } from 'react';
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

const DataConsolidation: React.FC<{ currentUser: User }> = ({ currentUser }) => {
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

        const headerLine = lines[0].replace(/^\uFEFF/, ''); // Robust BOM removal
        const header = splitCsvLine(headerLine).map(h => h.trim().toUpperCase().replace(/[\s/]+/g, ''));
        const rows = lines.slice(1);

        return rows.map(row => {
            if (!row.trim()) return null;

            const values = splitCsvLine(row);
            const entry: PartialEquipment = {};

            header.forEach((colName, index) => {
                const mappedKey = mappings[colName];
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

            const baseMappings: { [key: string]: keyof Equipment } = {
                'EQUIPAMENTO': 'equipamento', 'GARANTIA': 'garantia', 'PATRIMONIO': 'patrimonio', 'SERIAL': 'serial',
                'USUARIOATUAL': 'usuarioAtual', 'USUARIOANTERIOR': 'usuarioAnterior', 'LOCAL': 'local', 'SETOR': 'setor',
                'DATAENTREGAOUSUARIO': 'dataEntregaUsuario', 'STATUS': 'status', 'DATADEDEVOLUCAO': 'dataDevolucao',
                'TIPO': 'tipo', 'NOTADECOMPRA': 'notaCompra', 'NOTAPLKM': 'notaPlKm',
                'TERMODERESPONSABILIDADE': 'termoResponsabilidade', 'FOTO': 'foto', 'QRCODE': 'qrCode',
                'MARCA': 'brand', 'MODELO': 'model', 'EMAILCOLABORADOR': 'emailColaborador',
                'IDENTIFICADOR': 'identificador', 'NOMEDOSO': 'nomeSO', 'MEMORIAFISICATOTAL': 'memoriaFisicaTotal', 
                'GRUPODEPOLITICAS': 'grupoPoliticas', 'PAIS': 'pais', 'CIDADE': 'cidade', 'ESTADOPROVINCIA': 'estadoProvincia'
            };

            const absoluteMappings: { [key: string]: keyof Equipment } = {
                'NOMEDODISPOSITIVO': 'equipamento', 'NUMERODESERIE': 'serial',
                'NOMEDOUSUARIOATUAL': 'usuarioAtual', 'MARCA': 'brand', 'MODELO': 'model',
                'EMAILDOCOLABORADOR': 'emailColaborador',
                'IDENTIFICADOR': 'identificador', 'NOMEDOSO': 'nomeSO', 'MEMORIAFISICATOTAL': 'memoriaFisicaTotal', 
                'GRUPODEPOLITICAS': 'grupoPoliticas', 'PAIS': 'pais', 'CIDADE': 'cidade', 'ESTADOPROVINCIA': 'estadoProvincia'
            };


            if (baseFile) {
                const baseText = await baseFile.text();
                baseData = parseCsv(baseText, baseMappings);
            }

            if (absoluteFile) {
                const absoluteText = await absoluteFile.text();
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
                    } else if (item.status !== 'Manutenção' && item.status !== 'Descartado' && item.status !== 'Perdido' && item.status !== 'Doado') {
                         // Only set to estoque if not already a fixed status
                        return { ...item, status: 'Estoque', usuarioAtual: '', emailColaborador: '' };
                    }
                    return item;
                });
            } else if (baseFile) {
                finalData = baseData.map(item => {
                    if (item.usuarioAtual && item.usuarioAtual.trim() !== '') {
                        return { ...item, status: 'Em Uso' };
                    } else if (item.status !== 'Manutenção' && item.status !== 'Descartado' && item.status !== 'Perdido' && item.status !== 'Doado') {
                        return { ...item, status: 'Estoque', usuarioAtual: '', emailColaborador: '' };
                    }
                    return item;
                });
            } else if (absoluteFile) {
                finalData = absoluteData.map(item => {
                    if (item.usuarioAtual && item.usuarioAtual.trim() !== '') {
                        return { ...item, status: 'Em Uso' };
                    } else if (item.status !== 'Manutenção' && item.status !== 'Descartado' && item.status !== 'Perdido' && item.status !== 'Doado') {
                        return { ...item, status: 'Estoque', usuarioAtual: '', emailColaborador: '' };
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
                alert('Inventário consolidado e salvo com sucesso! A aplicação será recarregada para refletir as mudanças.');
                window.location.reload();
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
        <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold text-brand-secondary dark:text-dark-text-primary mb-2 border-b dark:border-dark-border pb-2">Ferramenta de Consolidação de Inventário</h3>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-4">
                Faça o upload da Planilha Base e do Relatório Absolute para consolidar os dados. O resultado substituirá o inventário atual do sistema.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FileUploadBox
                    title="1. Planilha Base"
                    icon="Sheet"
                    file={baseFile}
                    onFileChange={(e) => setBaseFile(e.target.files ? e.target.files[0] : null)}
                    isLoading={isLoading || isSaving}
                />
                <FileUploadBox
                    title="2. Relatório Absolute"
                    icon="FileText"
                    file={absoluteFile}
                    onFileChange={(e) => setAbsoluteFile(e.target.files ? e.target.files[0] : null)}
                    isLoading={isLoading || isSaving}
                />
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={handleConsolidate}
                    disabled={(!baseFile && !absoluteFile) || isLoading || isSaving}
                    className="bg-brand-primary text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold"
                    aria-label={isLoading ? 'Processando dados' : 'Consolidar dados'}
                >
                    {isLoading ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Combine" />}
                    {isLoading ? 'Processando...' : '1. Consolidar Dados'}
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
                            {isSaving ? 'Salvando...' : '2. Salvar e Substituir Inventário'}
                        </button>
                    </div>
                 </div>
            )}
        </div>
    );
};

export default DataConsolidation;]]></content>
</change>
<change>
<file>components/PeriodicAbsoluteUpdate.tsx</file>
<description>
      Cria um novo componente para gerenciar as atualizações periódicas de inventário usando o Relatório Absolute.
      Este componente permite que os administradores importem um único arquivo CSV para atualizar ou adicionar equipamentos
      com base em seus números de série, sem zerar o histórico ou o inventário existente.
      A visibilidade deste componente é controlada pela configuração `hasInitialConsolidationRun`.
    </description>
<content><![CDATA[import React, { useState, useRef, useMemo } from 'react';
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
    const [previewData, setPreviewData] = useState<PartialEquipment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

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

        const headerLine = lines[0].replace(/^\uFEFF/, ''); // Robust BOM removal
        const header = splitCsvLine(headerLine).map(h => h.trim().toUpperCase().replace(/[\s/]+/g, ''));
        const rows = lines.slice(1);

        return rows.map(row => {
            if (!row.trim()) return null;

            const values = splitCsvLine(row);
            const entry: PartialEquipment = {};

            header.forEach((colName, index) => {
                const mappedKey = mappings[colName];
                if (mappedKey && index < values.length) {
                    (entry as any)[mappedKey] = values[index]?.trim() || '';
                }
            });

            if (!entry.serial || entry.serial.trim() === '') {
                return null;
            }
            return entry;
        }).filter((item): item is PartialEquipment => item !== null);
    };

    const handlePreview = async () => {
        if (!absoluteFile) {
            setError("Por favor, selecione um arquivo do Relatório Absolute.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setPreviewData([]);

        try {
            const absoluteText = await absoluteFile.text();
            const absoluteMappings: { [key: string]: keyof Equipment } = {
                'NOMEDODISPOSITIVO': 'equipamento', 'NUMERODESERIE': 'serial',
                'NOMEDOUSUARIOATUAL': 'usuarioAtual', 'MARCA': 'brand', 'MODELO': 'model',
                'EMAILDOCOLABORADOR': 'emailColaborador',
                'IDENTIFICADOR': 'identificador', 'NOMEDOSO': 'nomeSO', 'MEMORIAFISICATOTAL': 'memoriaFisicaTotal', 
                'GRUPODEPOLITICAS': 'grupoPoliticas', 'PAIS': 'pais', 'CIDADE': 'cidade', 'ESTADOPROVINCIA': 'estadoProvincia'
            };
            const data = parseCsv(absoluteText, absoluteMappings);
            setPreviewData(data);

        } catch (e: any) {
            setError(`Falha ao processar arquivo: ${e.message}`);
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateSystem = async () => {
        if (previewData.length === 0) return;
        
        const confirmMessage = `Esta ação irá ATUALIZAR equipamentos existentes e ADICIONAR novos equipamentos com base nos ${previewData.length} itens do Relatório Absolute. Equipamentos não presentes neste relatório NÃO serão removidos. Deseja continuar?`;
        
        if (!window.confirm(confirmMessage)) return;
        
        setIsSaving(true);
        setError(null);
        try {
            const dataToSave = previewData.map(item => ({...item, id: undefined})) as Omit<Equipment, 'id'>[];
            const result = await periodicUpdateEquipment(dataToSave, currentUser.username);
            if (result.success) {
                alert('Inventário atualizado periodicamente com sucesso! A aplicação será recarregada para refletir as mudanças.');
                onUpdateSuccess(); // Refresh parent settings and dashboard
                window.location.reload();
            } else {
                setError(`Falha ao atualizar no sistema: ${result.message}`);
            }
        } catch (e: any) {
            setError(`Falha ao atualizar no sistema: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const filteredData = useMemo(() => {
        if (!searchTerm) return previewData;
        const lowercasedFilter = searchTerm.toLowerCase();
        return previewData.filter(item => {
            return Object.values(item).some(value =>
                String(value).toLowerCase().includes(lowercasedFilter)
            );
        });
    }, [searchTerm, previewData]);

    const tableHeaders: (keyof Equipment)[] = [
        'equipamento', 'serial', 'usuarioAtual', 'brand', 'model', 
        'identificador', 'nomeSO', 'memoriaFisicaTotal', 'grupoPoliticas', 'pais', 'cidade', 'estadoProvincia'
    ];

    return (
        <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md">
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-4">
                Faça o upload do Relatório Absolute para atualizar o inventário existente ou adicionar novos equipamentos.
            </p>

            <div className="max-w-xl mx-auto">
                <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">
                    Arquivo do Relatório Absolute (CSV)
                </label>
                <div className="bg-white dark:bg-dark-card p-4 rounded-lg shadow-inner border dark:border-dark-border">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => {
                            setAbsoluteFile(e.target.files ? e.target.files[0] : null);
                            setPreviewData([]); // Clear preview when new file selected
                        }}
                        accept=".csv"
                        disabled={isLoading || isSaving}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-200 dark:file:bg-gray-700 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-300 dark:hover:file:bg-gray-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Selecionar arquivo CSV do Relatório Absolute"
                    />
                    {absoluteFile && (
                        <p className="mt-2 text-xs text-gray-600 dark:text-dark-text-secondary">Arquivo selecionado: {absoluteFile.name}</p>
                    )}
                </div>
            </div>

            <div className="mt-6 flex justify-center gap-4">
                <button
                    onClick={handlePreview}
                    disabled={!absoluteFile || isLoading || isSaving}
                    className="bg-brand-primary text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold"
                    aria-label={isLoading ? 'Processando dados' : 'Pré-visualizar dados'}
                >
                    {isLoading ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="Eye" />}
                    {isLoading ? 'Processando...' : '1. Pré-visualizar Dados'}
                </button>
            </div>

            {error && <div className="mt-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert"><p>{error}</p></div>}
            
            {previewData.length > 0 && !isLoading && (
                 <div className="mt-6">
                    <h3 className="text-xl font-bold text-brand-dark dark:text-dark-text-primary mb-4">
                        Pré-visualização da Atualização ({filteredData.length} de {previewData.length} itens)
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
                            onClick={handleUpdateSystem}
                            disabled={isSaving}
                            className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-lg font-semibold"
                            aria-label={isSaving ? 'Atualizando inventário' : '2. Atualizar Inventário'}
                        >
                            {isSaving ? <Icon name="LoaderCircle" className="animate-spin" /> : <Icon name="RefreshCcw" />}
                            {isSaving ? 'Atualizando...' : '2. Atualizar Inventário'}
                        </button>
                    </div>
                 </div>
            )}
        </div>
    );
};

export default PeriodicAbsoluteUpdate;]]></content>
</change>
</changes>
```