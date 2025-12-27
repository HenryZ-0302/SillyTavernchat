/**
 * 全站备份与恢复 API
 * 仅限管理员使用
 */

import path from 'node:path';
import fs from 'node:fs';
import yaml from 'yaml';
import archiver from 'archiver';
import express from 'express';

import { color } from '../util.js';

export const router = express.Router();

// 备份存储目录
const BACKUPS_DIR = '_site_backups';

/**
 * 获取备份目录路径
 * @returns {string} 备份目录的绝对路径
 */
function getBackupsDir() {
    const backupsPath = path.join(globalThis.DATA_ROOT, BACKUPS_DIR);
    if (!fs.existsSync(backupsPath)) {
        fs.mkdirSync(backupsPath, { recursive: true });
    }
    return backupsPath;
}

/**
 * 检查是否为管理员
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.profile || !req.user.profile.admin) {
        return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
}

// 所有路由都需要管理员权限
router.use(requireAdmin);

/**
 * POST /api/admin/backup/create
 * 创建全站备份
 */
router.post('/create', async (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `site-backup-${timestamp}.zip`;
        const backupsDir = getBackupsDir();
        const outputPath = path.join(backupsDir, filename);

        console.log(color.green(`[Backup] 开始创建全站备份: ${filename}`));

        // 创建 zip 文件
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 6 } // 中等压缩级别，平衡速度和大小
        });

        // 监听完成事件
        const archiveFinished = new Promise((resolve, reject) => {
            output.on('close', () => {
                console.log(color.green(`[Backup] 备份完成: ${archive.pointer()} bytes`));
                resolve();
            });
            archive.on('error', (err) => {
                console.error(color.red(`[Backup] 备份失败:`), err);
                reject(err);
            });
        });

        archive.pipe(output);

        // 添加 DATA_ROOT 目录中的所有内容（排除备份目录本身）
        const dataRoot = globalThis.DATA_ROOT;
        const entries = fs.readdirSync(dataRoot);

        for (const entry of entries) {
            // 跳过备份目录本身
            if (entry === BACKUPS_DIR) continue;
            // 跳过所有 config 相关的文件和目录（会从根目录单独添加）
            if (entry === 'config' || entry === 'config.yaml') continue;

            const entryPath = path.join(dataRoot, entry);
            const stat = fs.statSync(entryPath);

            if (stat.isDirectory()) {
                archive.directory(entryPath, entry);
            } else {
                archive.file(entryPath, { name: entry });
            }
        }

        // 如果 config.yaml 在项目根目录，也添加进去
        // 注意：可能是符号链接，需要读取实际内容
        const configPath = path.join(process.cwd(), 'config.yaml');
        if (fs.existsSync(configPath)) {
            // 读取实际内容（处理符号链接的情况）
            const realConfigPath = fs.realpathSync(configPath);
            const configContent = fs.readFileSync(realConfigPath, 'utf8');

            // 验证内容有效性
            if (configContent && configContent.trim().length > 0) {
                archive.append(configContent, { name: 'config.yaml' });
                console.log(color.blue(`[Backup] 已添加 config.yaml (来源: ${realConfigPath})`));
            } else {
                console.warn(color.yellow(`[Backup] config.yaml 内容为空，跳过`));
            }
        }

        await archive.finalize();
        await archiveFinished;

        const stats = fs.statSync(outputPath);

        res.json({
            success: true,
            filename: filename,
            size: stats.size,
            message: `备份创建成功: ${filename}`
        });

    } catch (error) {
        console.error(color.red('[Backup] 创建备份失败:'), error);
        res.status(500).json({ error: `创建备份失败: ${error.message}` });
    }
});

/**
 * GET /api/admin/backup/list
 * 列出所有备份
 */
router.get('/list', async (req, res) => {
    try {
        const backupsDir = getBackupsDir();
        const files = fs.readdirSync(backupsDir);

        const backups = files
            .filter(file => file.endsWith('.zip'))
            .map(file => {
                const filePath = path.join(backupsDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.mtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created)); // 最新的在前

        res.json({ backups });

    } catch (error) {
        console.error(color.red('[Backup] 列出备份失败:'), error);
        res.status(500).json({ error: `列出备份失败: ${error.message}` });
    }
});

/**
 * GET /api/admin/backup/download/:filename
 * 下载备份文件
 */
router.get('/download/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        // 安全检查：防止路径穿越
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: '无效的文件名' });
        }

        const backupsDir = getBackupsDir();
        const filePath = path.join(backupsDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '备份文件不存在' });
        }

        res.download(filePath, filename);

    } catch (error) {
        console.error(color.red('[Backup] 下载备份失败:'), error);
        res.status(500).json({ error: `下载备份失败: ${error.message}` });
    }
});

/**
 * DELETE /api/admin/backup/:filename
 * 删除备份文件
 */
router.delete('/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        // 安全检查：防止路径穿越
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: '无效的文件名' });
        }

        const backupsDir = getBackupsDir();
        const filePath = path.join(backupsDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '备份文件不存在' });
        }

        fs.unlinkSync(filePath);
        console.log(color.yellow(`[Backup] 已删除备份: ${filename}`));

        res.json({ success: true, message: `已删除备份: ${filename}` });

    } catch (error) {
        console.error(color.red('[Backup] 删除备份失败:'), error);
        res.status(500).json({ error: `删除备份失败: ${error.message}` });
    }
});

/**
 * POST /api/admin/backup/restore
 * 恢复备份（从服务器上的备份文件）
 */
router.post('/restore', async (req, res) => {
    try {
        const { filename, confirmRestore } = req.body;

        if (!filename) {
            return res.status(400).json({ error: '请指定要恢复的备份文件' });
        }

        if (confirmRestore !== 'CONFIRM_RESTORE') {
            return res.status(400).json({ error: '请确认恢复操作' });
        }

        // 安全检查
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: '无效的文件名' });
        }

        const backupsDir = getBackupsDir();
        const backupPath = path.join(backupsDir, filename);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: '备份文件不存在' });
        }

        console.log(color.yellow(`[Backup] 开始恢复备份: ${filename}`));

        // 1. 先创建当前数据的备份
        const preRestoreTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestoreFilename = `pre-restore-${preRestoreTimestamp}.zip`;
        const preRestorePath = path.join(backupsDir, preRestoreFilename);

        console.log(color.blue(`[Backup] 恢复前先备份当前数据: ${preRestoreFilename}`));

        const preOutput = fs.createWriteStream(preRestorePath);
        const preArchive = archiver('zip', { zlib: { level: 6 } });

        const preArchiveFinished = new Promise((resolve, reject) => {
            preOutput.on('close', resolve);
            preArchive.on('error', reject);
        });

        preArchive.pipe(preOutput);

        const dataRoot = globalThis.DATA_ROOT;
        const entries = fs.readdirSync(dataRoot);

        for (const entry of entries) {
            if (entry === BACKUPS_DIR) continue;
            const entryPath = path.join(dataRoot, entry);
            const stat = fs.statSync(entryPath);
            if (stat.isDirectory()) {
                preArchive.directory(entryPath, entry);
            } else {
                preArchive.file(entryPath, { name: entry });
            }
        }

        await preArchive.finalize();
        await preArchiveFinished;

        // 解压备份
        console.log(color.blue(`[Backup] 解压备份文件...`));

        // 3. 如果启用了 clearData，执行安全清空
        if (req.body.clearData === true) {
            console.log(color.yellow(`[Backup] 用户选择清空模式，正在清除旧数据...`));

            // 白名单：绝对不能删的文件/目录
            const WHITELIST = [
                BACKUPS_DIR, // 备份目录
                '.git',
                'node_modules',
                'package.json',
                'package-lock.json',
                'config.yaml', // 配置文件保留
                'config',      // 配置目录保留（Zeabur 可能挂载在这里）
                'public',      // 前端静态文件
                'src',         // 源代码
            ];

            const entries = fs.readdirSync(dataRoot);
            for (const entry of entries) {
                // 如果在白名单里，跳过
                if (WHITELIST.includes(entry)) continue;

                const entryPath = path.join(dataRoot, entry);
                try {
                    fs.rmSync(entryPath, { recursive: true, force: true });
                } catch (e) {
                    console.warn(color.red(`[Backup] 无法删除 ${entry}: ${e.message}`));
                }
            }
        }

        // 使用 unzipper 解析 zip 内容
        const unzipperImport = await import('unzipper');
        const unzipper = unzipperImport.default || unzipperImport;
        const directory = await unzipper.Open.file(backupPath);

        for (const file of directory.files) {
            // 跳过备份目录本身
            if (file.path.startsWith(BACKUPS_DIR)) continue;

            let targetPath;
            let alsoSaveToData = false; // 是否同时保存到 data 目录

            if (file.path === 'config.yaml') {
                targetPath = path.join(process.cwd(), 'config.yaml');
                alsoSaveToData = true; // config.yaml 需要同时保存到 data 目录作为持久化备份
            } else {
                targetPath = path.join(dataRoot, file.path);
            }

            // 确保目标目录存在
            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 如果是目录，跳过
            if (file.type === 'Directory') continue;

            // 流式解压单个文件
            const fileBuffer = await file.buffer();

            // 如果是 config.yaml，先验证内容是否有效
            if (file.path === 'config.yaml') {
                const configContent = fileBuffer.toString('utf8');
                let isValidConfig = false;
                try {
                    if (configContent && configContent.trim().length > 0) {
                        // const yaml = require('yaml'); // Removed: using import
                        const parsed = yaml.parse(configContent);
                        isValidConfig = parsed && typeof parsed === 'object';
                    }
                } catch {
                    isValidConfig = false;
                }

                if (!isValidConfig) {
                    console.warn(color.yellow(`[Backup] 备份中的 config.yaml 无效，跳过覆盖，保留当前配置`));
                    continue; // 跳过这个文件，不覆盖
                }
            }

            fs.writeFileSync(targetPath, fileBuffer);

            // 如果是 config.yaml，同时保存到 data 目录和 config 目录作为持久化备份
            if (alsoSaveToData) {
                // 保存到 data 目录
                const dataConfigPath = path.join(dataRoot, 'config.yaml');
                fs.writeFileSync(dataConfigPath, fileBuffer);
                console.log(color.blue(`[Backup] config.yaml 已同步保存到 data 目录: ${dataConfigPath}`));

                // 保存到 config 目录 (Zeabur 持久化挂载点)
                const configDirPath = path.join(process.cwd(), 'config', 'config.yaml');
                const configDir = path.dirname(configDirPath);
                if (!fs.existsSync(configDir)) {
                    fs.mkdirSync(configDir, { recursive: true });
                }
                fs.writeFileSync(configDirPath, fileBuffer);
                console.log(color.blue(`[Backup] config.yaml 已同步保存到 config 目录: ${configDirPath}`));
            }
        }

        // 恢复完成后，验证 config.yaml 是否有效
        const configPath = path.join(process.cwd(), 'config.yaml');
        const defaultConfigPath = path.join(process.cwd(), 'default', 'config.yaml');

        const isConfigValid = () => {
            if (!fs.existsSync(configPath)) return false;
            try {
                const content = fs.readFileSync(configPath, 'utf8');
                if (!content || content.trim().length === 0) return false;
                const yaml = require('yaml');
                const parsed = yaml.parse(content);
                return parsed && typeof parsed === 'object';
            } catch {
                return false;
            }
        };

        if (!isConfigValid()) {
            console.warn(color.yellow(`[Backup] 恢复后 config.yaml 无效，从默认配置恢复...`));
            if (fs.existsSync(defaultConfigPath)) {
                fs.copyFileSync(defaultConfigPath, configPath);
                console.log(color.green(`[Backup] 已从默认配置恢复 config.yaml`));
            }
        }

        console.log(color.green(`[Backup] 恢复完成！需要重启服务以应用配置更改。`));

        res.json({
            success: true,
            message: '恢复完成！请重启服务以应用配置更改。',
            preRestoreBackup: preRestoreFilename
        });

    } catch (error) {
        console.error(color.red('[Backup] 恢复备份失败:'), error);
        res.status(500).json({ error: `恢复备份失败: ${error.message}` });
    }
});

/**
 * POST /api/admin/backup/cleanup
 * 清理过期备份
 */
router.post('/cleanup', async (req, res) => {
    try {
        const days = parseInt(req.body.days) || 30; // 默认30天
        const backupsDir = getBackupsDir();
        const files = fs.readdirSync(backupsDir);

        const now = Date.now();
        const MAX_AGE = days * 24 * 60 * 60 * 1000;

        let deletedCount = 0;
        let releasedBytes = 0;

        for (const file of files) {
            // 只处理 zip 文件
            if (!file.endsWith('.zip')) continue;

            const filePath = path.join(backupsDir, file);
            const stat = fs.statSync(filePath);

            // 如果文件修改时间超过指定天数
            if (now - stat.mtimeMs > MAX_AGE) {
                fs.unlinkSync(filePath);
                deletedCount++;
                releasedBytes += stat.size;
                console.log(color.yellow(`[Backup] 自动清理过期备份: ${file}`));
            }
        }

        res.json({
            success: true,
            deletedCount,
            releasedBytes,
            message: `已清理 ${deletedCount} 个过期备份`
        });

    } catch (error) {
        console.error(color.red('[Backup] 清理过期备份失败:'), error);
        res.status(500).json({ error: `清理失败: ${error.message}` });
    }
});
