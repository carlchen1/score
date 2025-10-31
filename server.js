const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 存储游戏状态
let gameState = {
    team1: 0,
    team2: 0,
    team1Name: "红队",
    team2Name: "蓝队",
    lastUpdated: new Date().toISOString()
};

// 存储连接的客户端
let clients = new Set();
let serverStartTime = new Date().toISOString();

// 创建HTTP服务器
const server = http.createServer((req, res) => {
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 如果请求根路径，返回HTML页面
    if (req.url === '/' || req.url === '/index.html') {
        const htmlPath = path.join(__dirname, 'index.html');

        // 检查外部HTML文件是否存在
        fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
                // 如果文件不存在，返回内嵌的HTML页面
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getDefaultHTML());
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            }
        });
    }
    // 提供状态API
    else if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            gameState: gameState,
            connectedClients: clients.size,
            serverStartTime: serverStartTime
        }));
    }
    else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// 内嵌的默认HTML页面（备用）
function getDefaultHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>比分系统服务器</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
        .status { padding: 20px; background: #e8f5e8; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏀 实时比分系统服务器</h1>
        <div class="status">
            <p>✅ 服务器运行正常</p>
            <p>📊 请将 index.html 文件放在服务器目录下</p>
            <p>🌐 访问 <a href="/">首页</a> 使用比分系统</p>
        </div>
    </div>
</body>
</html>`;
}

// 创建WebSocket服务器
const wss = new WebSocket.Server({
    server: server,
    clientTracking: true
});

// 广播消息给所有客户端
function broadcastToAllClients(message) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('发送消息失败:', error);
                clients.delete(client);
            }
        }
    });
}

// 广播游戏状态给所有客户端
function broadcastState() {
    const message = JSON.stringify({
        type: 'stateUpdate',
        data: gameState,
        timestamp: new Date().toISOString()
    });

    broadcastToAllClients(message);
}

// 广播客户端数量
function broadcastClientCount() {
    const countMessage = JSON.stringify({
        type: 'clientCount',
        count: clients.size,
        timestamp: new Date().toISOString()
    });

    broadcastToAllClients(countMessage);
}

// 广播效果触发消息
function broadcastEffectsTrigger(team, points, playSound = false, excludeClient = null) {
    const effectsMessage = JSON.stringify({
        type: 'triggerEffects',
        team: team,
        points: points,
        playSound: playSound,
        timestamp: new Date().toISOString()
    });

    console.log(`广播效果触发消息给其他客户端: 队伍${team} 分数变化 ${points}`);
    
    let broadcastCount = 0;
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeClient) {
            try {
                client.send(effectsMessage);
                broadcastCount++;
            } catch (error) {
                console.error('发送效果消息失败:', error);
            }
        }
    });
    
    console.log(`效果消息已发送给 ${broadcastCount} 个客户端`);
}

// 发送错误消息
function sendError(ws, message) {
    try {
        ws.send(JSON.stringify({
            type: 'error',
            message: message,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error('发送错误消息失败:', error);
    }
}

// 发送当前状态
function sendCurrentState(ws) {
    try {
        ws.send(JSON.stringify({
            type: 'state',
            data: gameState,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error('发送状态失败:', error);
    }
}

// 记录操作日志
function logAction(clientIP, action, details) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        ip: clientIP,
        action: action,
        details: details,
        gameState: { ...gameState }
    };

    console.log('操作日志:', JSON.stringify(logEntry));
}

// 处理分数更新
function handleScoreUpdate(data, clientIP, ws) {
    if (data.team === 1 || data.team === 2) {
        const teamKey = `team${data.team}`;
        const oldScore = gameState[teamKey];
        gameState[teamKey] = Math.max(0, gameState[teamKey] + (data.points || 0));
        gameState.lastUpdated = new Date().toISOString();

        console.log(`IP:${clientIP} 队伍${data.team} 分数更新: ${oldScore} -> ${gameState[teamKey]}`);
        
        // 广播状态更新
        broadcastState();

        // 广播效果触发消息给其他客户端（排除操作端）
        if (data.triggerEffects) {
            broadcastEffectsTrigger(data.team, data.points, data.playSound, ws);
        }

        logAction(clientIP, `updateScore`, `队伍${data.team} 分数 ${data.points > 0 ? '+' : ''}${data.points}`);
    }
}

// 处理队伍名称更新
function handleTeamNameUpdate(data, clientIP) {
    if (data.team === 1 || data.team === 2) {
        const nameKey = `team${data.team}Name`;
        const oldName = gameState[nameKey];
        gameState[nameKey] = data.name || `队伍${data.team}`;
        gameState.lastUpdated = new Date().toISOString();

        console.log(`IP:${clientIP} 队伍${data.team} 名称更新: "${oldName}" -> "${gameState[nameKey]}"`);
        broadcastState();

        logAction(clientIP, `updateTeamName`, `队伍${data.team} 名称改为: ${gameState[nameKey]}`);
    }
}

// 处理分数重置
function handleResetScores(clientIP) {
    const oldScores = { team1: gameState.team1, team2: gameState.team2 };
    gameState.team1 = 0;
    gameState.team2 = 0;
    gameState.lastUpdated = new Date().toISOString();

    console.log(`IP:${clientIP} 分数重置: 队伍1:${oldScores.team1}->0, 队伍2:${oldScores.team2}->0`);
    broadcastState();

    logAction(clientIP, `reset`, '所有分数已重置');
}

// 处理客户端消息
function handleClientMessage(data, ws, clientIP) {
    switch (data.type) {
        case 'updateScore':
            handleScoreUpdate(data, clientIP, ws); // 传入ws参数
            break;

        case 'updateTeamName':
            handleTeamNameUpdate(data, clientIP);
            break;

        case 'reset':
            handleResetScores(clientIP);
            break;

        case 'getState':
            sendCurrentState(ws);
            break;

        case 'ping':
            // 响应心跳
            try {
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            } catch (error) {
                console.error('发送pong失败:', error);
            }
            break;

        default:
            console.log('未知消息类型 from', clientIP, ':', data.type);
            sendError(ws, '未知的消息类型: ' + data.type);
    }
}

// 处理WebSocket连接
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log('新的客户端连接，IP:', clientIP);
    clients.add(ws);

    // 发送欢迎消息和当前状态
    try {
        ws.send(JSON.stringify({
            type: 'welcome',
            message: '已连接到实时比分系统',
            clientCount: clients.size,
            timestamp: new Date().toISOString()
        }));

        ws.send(JSON.stringify({
            type: 'init',
            data: gameState,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error('发送初始化数据失败:', error);
    }

    broadcastClientCount();

    // 处理客户端消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('收到消息 from', clientIP, ':', data);

            handleClientMessage(data, ws, clientIP);

        } catch (error) {
            console.error('消息解析错误:', error);
            sendError(ws, '无效的消息格式');
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        console.log('客户端断开连接，IP:', clientIP);
        clients.delete(ws);
        broadcastClientCount();
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error('WebSocket错误，IP:', clientIP, '错误:', error);
        clients.delete(ws);
        broadcastClientCount();
    });

    // 心跳检测
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// 心跳检测
setInterval(() => {
    clients.forEach(client => {
        if (client.isAlive === false) {
            client.terminate();
            clients.delete(client);
            return;
        }

        client.isAlive = false;
        try {
            client.ping();
        } catch (error) {
            console.error('心跳检测失败:', error);
            clients.delete(client);
        }
    });

    // 每30秒广播一次客户端数量
    broadcastClientCount();
}, 30000);

// 保存状态到文件
function saveStateToFile() {
    const stateFile = path.join(__dirname, 'game_state.json');
    fs.writeFile(stateFile, JSON.stringify(gameState, null, 2), (err) => {
        if (err) {
            console.error('保存状态文件失败:', err);
        } else {
            console.log('游戏状态已保存到文件');
        }
    });
}

// 从文件加载状态
function loadStateFromFile() {
    const stateFile = path.join(__dirname, 'game_state.json');
    fs.readFile(stateFile, 'utf8', (err, data) => {
        if (!err) {
            try {
                const savedState = JSON.parse(data);
                // 只覆盖已存在的字段，保持新字段
                gameState = { ...gameState, ...savedState };
                console.log('已从文件加载游戏状态');
            } catch (parseError) {
                console.error('解析状态文件失败:', parseError);
            }
        }
    });
}

// 获取本地IP地址
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return 'localhost';
}

// 使用3000端口
const PORT = process.env.PORT || 3000;

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏀 实时比分系统服务器已启动`);
    console.log(`📊 HTTP服务器运行在 http://localhost:${PORT}`);
    console.log(`🔌 WebSocket服务器运行在 ws://localhost:${PORT}`);
    console.log(`🌐 局域网访问地址: http://${getLocalIP()}:${PORT}`);
    console.log(`📱 API状态接口: http://localhost:${PORT}/api/status`);
    console.log(`🎮 当前游戏状态: ${gameState.team1Name}: ${gameState.team1}分, ${gameState.team2Name}: ${gameState.team2}分`);

    // 加载保存的状态
    loadStateFromFile();

    // 每5分钟自动保存一次状态
    setInterval(saveStateToFile, 5 * 60 * 1000);

    // 记录服务器启动时间
    serverStartTime = new Date().toISOString();
});

// 优雅关闭处理
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    saveStateToFile();

    // 关闭所有客户端连接
    clients.forEach(client => {
        try {
            client.close(1000, '服务器关闭');
        } catch (error) {
            console.error('关闭客户端连接失败:', error);
        }
    });

    server.close(() => {
        console.log('服务器已正常关闭');
        process.exit(0);
    });
});

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});

module.exports = { server, wss, gameState };