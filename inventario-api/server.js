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
    const username = req.body.username;
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

        await connection.commit();
        logAction(username, 'UPDATE', 'EQUIPMENT', 'ALL', `Replaced entire equipment inventory with ${equipmentList.length} items via consolidation tool.`);
        res.json({ success: true, message: 'Inventário de equipamentos importado com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error("Equipment import error:", err);
        res.status(500).json({ success: false, message: `Erro de banco de dados durante a importação: ${err.message}` });
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
        logAction(username, 'UPDATE', 'LICENSE', productName, `Replaced all licenses for product ${productName} with ${licenses.length} new items via CSV import.`);
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
    } catch (err) {
        res.status(500).json({ message: "Database error", error: err });
    }
});

app.post('/api/approvals/approve', async (req, res) => {
    const { type, id, username } = req.body;
    const table = type === 'equipment' ? 'equipment' : 'licenses';
    try {
        await db.promise().query(`UPDATE ${table} SET approval_status = 'approved' WHERE id = ?`, [id]);
        logAction(username, 'UPDATE', type.toUpperCase(), id, 'Approved item');
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Database error", error: err });
    }
});

app.post('/api/approvals/reject', async (req, res) => {
    const { type, id, username, reason } = req.body;
    const table = type === 'equipment' ? 'equipment' : 'licenses';
    try {
        await db.promise().query(`UPDATE ${table} SET approval_status = 'rejected', rejection_reason = ? WHERE id = ?`, [reason, id]);
        logAction(username, 'UPDATE', type.toUpperCase(), id, `Rejected item. Reason: ${reason}`);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Database error", error: err });
    }
});

// --- 2FA Endpoints ---
app.post('/api/generate-2fa', async (req, res) => {
    const { userId } = req.body;
    try {
        const [users] = await db.promise().query('SELECT username, email FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ message: 'User not found' });

        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(users[0].email, 'InventarioPro', secret);

        await db.promise().query('UPDATE users SET twoFASecret = ? WHERE id = ?', [secret, userId]);

        res.json({ secret, qrCodeUrl: otpauth });
    } catch (error) {
        res.status(500).json({ message: "Failed to generate 2FA secret." });
    }
});

app.post('/api/enable-2fa', async (req, res) => {
    const { userId, token } = req.body;
    try {
        const [users] = await db.promise().query('SELECT twoFASecret FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ message: 'User not found' });

        const isValid = authenticator.check(token, users[0].twoFASecret);
        if (isValid) {
            await db.promise().query('UPDATE users SET is2FAEnabled = TRUE WHERE id = ?', [userId]);
            res.status(204).send();
        } else {
            res.status(400).json({ message: 'Token inválido' });
        }
    } catch (error) {
        res.status(500).json({ message: "Failed to enable 2FA." });
    }
});

app.post('/api/disable-2fa', async (req, res) => {
    const { userId } = req.body;
    try {
        await db.promise().query('UPDATE users SET is2FAEnabled = FALSE, twoFASecret = NULL WHERE id = ?', [userId]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: "Failed to disable 2FA." });
    }
});

app.post('/api/disable-user-2fa', async (req, res) => {
    // This endpoint should be protected by an admin middleware
    const { userId } = req.body;
    try {
        await db.promise().query('UPDATE users SET is2FAEnabled = FALSE, twoFASecret = NULL WHERE id = ?', [userId]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: "Failed to disable 2FA for user." });
    }
});

// --- SETTINGS ---
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT config_key, config_value FROM app_config");
        const settings = rows.reduce((acc, row) => {
            let value = row.config_value;
            if (value === 'true') value = true;
            if (value === 'false') value = false;
            if (row.config_key.endsWith('Port') && value) value = Number(value);
            acc[row.config_key] = value;
            return acc;
        }, {});
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve settings' });
    }
});

app.post('/api/settings', isAdmin, async (req, res) => {
    const { settings, username } = req.body;
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        for (const key in settings) {
            let value = settings[key];
            if (typeof value === 'boolean') {
                value = value.toString();
            }
            if (value === null || typeof value === 'undefined') {
                value = '';
            }
            await connection.query(
                "INSERT INTO app_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?",
                [key, value, value]
            );
        }
        await connection.commit();
        logAction(username, 'SETTINGS_UPDATE', 'SETTINGS', null, 'Updated application settings');
        res.json({ success: true, message: 'Configurações salvas com sucesso!' });
    } catch (err) {
        await connection.rollback();
        console.error("Save settings error:", err);
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    } finally {
        connection.release();
    }
});

// TERMO TEMPLATES
app.get('/api/config/termo-templates', async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT config_key, config_value FROM app_config WHERE config_key IN ('termo_entrega_template', 'termo_devolucao_template')");
        const templates = rows.reduce((acc, row) => {
            if (row.config_key === 'termo_entrega_template') acc.entregaTemplate = row.config_value;
            if (row.config_key === 'termo_devolucao_template') acc.devolucaoTemplate = row.config_value;
            return acc;
        }, { entregaTemplate: null, devolucaoTemplate: null });
        res.json(templates);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve term templates' });
    }
});

// --- DATABASE MANAGEMENT ---
app.get('/api/database/backup-status', (req, res) => {
    const backupFile = path.join(BACKUP_DIR, 'inventario_pro_backup.sql.gz');
    if (fs.existsSync(backupFile)) {
        const stats = fs.statSync(backupFile);
        res.json({ hasBackup: true, backupTimestamp: stats.mtime.toISOString() });
    } else {
        res.json({ hasBackup: false });
    }
});

app.post('/api/database/backup', isAdmin, (req, res) => {
    const backupFile = path.join(BACKUP_DIR, `inventario_pro_backup.sql.gz`);
    const command = `mysqldump -h ${DB_HOST} -u ${DB_USER} -p'${DB_PASSWORD}' ${DB_DATABASE} | gzip > ${backupFile}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Backup error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Falha ao criar backup.' });
        }
        if (stderr) {
            console.error(`Backup stderr: ${stderr}`);
            // Don't always fail on stderr, as mysqldump can write warnings there
        }
        logAction(req.body.username, 'UPDATE', 'DATABASE', null, 'Database backup created');
        res.json({ success: true, message: 'Backup do banco de dados criado com sucesso.', backupTimestamp: new Date().toISOString() });
    });
});

app.post('/api/database/restore', isAdmin, (req, res) => {
    const backupFile = path.join(BACKUP_DIR, 'inventario_pro_backup.sql.gz');
    if (!fs.existsSync(backupFile)) {
        return res.status(404).json({ success: false, message: 'Nenhum arquivo de backup encontrado.' });
    }
    const command = `gunzip < ${backupFile} | mysql -h ${DB_HOST} -u ${DB_USER} -p'${DB_PASSWORD}' ${DB_DATABASE}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Restore error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Falha ao restaurar o backup.' });
        }
        logAction(req.body.username, 'UPDATE', 'DATABASE', null, 'Database restored from backup');
        res.json({ success: true, message: 'Banco de dados restaurado com sucesso.' });
    });
});

app.post('/api/database/clear', isAdmin, async (req, res) => {
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('SET FOREIGN_KEY_CHECKS = 0;');
        await connection.query('DELETE FROM equipment_history');
        await connection.query('DELETE FROM licenses');
        await connection.query('DELETE FROM equipment');
        await connection.query('DELETE FROM audit_log');
        await connection.query('DELETE FROM app_config');
        await connection.query('DELETE FROM users WHERE username != ?', ['admin']);
        await connection.query('ALTER TABLE equipment_history AUTO_INCREMENT = 1');
        await connection.query('ALTER TABLE licenses AUTO_INCREMENT = 1');
        await connection.query('ALTER TABLE equipment AUTO_INCREMENT = 1');
        await connection.query('ALTER TABLE audit_log AUTO_INCREMENT = 1');
        await connection.query('ALTER TABLE app_config AUTO_INCREMENT = 1');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1;');
        await connection.commit();
        
        // Re-run initial data setup (migrations will handle this)
        await runMigrations();

        logAction(req.body.username, 'DELETE', 'DATABASE', 'ALL', 'Database cleared and reset to initial state');
        res.json({ success: true, message: 'Banco de dados zerado com sucesso. Apenas o usuário admin foi mantido.' });
    } catch (err) {
        await connection.rollback();
        console.error("Database clear error:", err);
        res.status(500).json({ success: false, message: `Erro ao zerar o banco de dados: ${err.message}` });
    } finally {
        connection.release();
    }
});


// --- SERVER STARTUP ---
const startServer = async () => {
    try {
        await runMigrations();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("Failed to start server due to migration errors:", err);
        process.exit(1);
    }
};

startServer();
