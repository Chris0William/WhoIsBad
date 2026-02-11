// 提醒工具 - 标题闪烁 + 浏览器通知（切后台时提醒）
const Notify = {
  _titleTimer: null,
  _originalTitle: document.title,
  _hasFocus: true,
  _permissionGranted: false,

  init() {
    this._originalTitle = document.title;
    window.addEventListener('focus', () => {
      this._hasFocus = true;
      this.clearTitleFlash();
    });
    window.addEventListener('blur', () => {
      this._hasFocus = false;
    });
    if ('Notification' in window && Notification.permission === 'granted') {
      this._permissionGranted = true;
    }
  },

  requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        this._permissionGranted = p === 'granted';
      });
    }
  },

  send(title, body) {
    if (this._hasFocus) return;
    this.flashTitle(title);
    if (this._permissionGranted) {
      try { new Notification(title, { body, silent: true }); } catch {}
    }
  },

  flashTitle(msg) {
    this.clearTitleFlash();
    let show = true;
    this._titleTimer = setInterval(() => {
      document.title = show ? `【${msg}】` : this._originalTitle;
      show = !show;
    }, 1000);
  },

  clearTitleFlash() {
    if (this._titleTimer) {
      clearInterval(this._titleTimer);
      this._titleTimer = null;
      document.title = this._originalTitle;
    }
  },
};

// 前端入口 - WebSocket连接管理 & 消息路由
const App = {
  ws: null,
  playerId: null,
  roomCode: null,
  isHost: false,
  settings: null,
  state: 'lobby', // lobby | waiting | playing
  reconnectAttempts: 0,
  maxReconnectDelay: 10000,

  init() {
    Notify.init();
    this.connect();
    this.bindTerminalInput();
    this.initTerminalResize();
    this.initMobilePanels();
    Lobby.show();
  },

  // 保存会话信息到sessionStorage
  saveSession() {
    if (this.playerId && this.roomCode) {
      sessionStorage.setItem('spy_session', JSON.stringify({
        playerId: this.playerId,
        roomCode: this.roomCode,
        isHost: this.isHost,
        state: this.state,
      }));
    }
  },

  // 读取保存的会话信息
  getSavedSession() {
    try {
      const data = sessionStorage.getItem('spy_session');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  // 清除会话
  clearSession() {
    sessionStorage.removeItem('spy_session');
  },

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      document.getElementById('status-connection').textContent = '⚡ 已连接';
      this.reconnectAttempts = 0;

      // 尝试重连到之前的房间
      const session = this.getSavedSession();
      if (session && session.roomCode && session.playerId) {
        this.send(MSG.RECONNECT, {
          roomCode: session.roomCode,
          playerId: session.playerId,
        });
      }
    };

    this.ws.onclose = () => {
      document.getElementById('status-connection').textContent = '⚡ 重连中...';
      // 指数退避重连
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), delay);
    };

    this.ws.onmessage = (event) => {
      const msg = unpack(event.data);
      if (!msg) return;
      this.handleMessage(msg.type, msg.data);
    };
  },

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pack(type, data));
    }
  },

  handleMessage(type, data) {
    switch (type) {
      case MSG.ROOM_CREATED:
        this.playerId = data.playerId;
        this.roomCode = data.roomCode;
        this.isHost = true;
        this.settings = data.settings;
        this.state = 'waiting';
        this.saveSession();
        Notify.requestPermission();
        Lobby.showWaitingRoom(data);
        break;

      case MSG.ROOM_JOINED:
        this.playerId = data.playerId;
        this.roomCode = data.roomCode;
        this.isHost = false;
        this.settings = data.settings;
        this.state = 'waiting';
        this.saveSession();
        Notify.requestPermission();
        Lobby.showWaitingRoom(data);
        break;

      case MSG.RECONNECTED:
        this.playerId = data.playerId;
        this.roomCode = data.roomCode;
        this.isHost = data.isHost;
        this.settings = data.settings;
        this.saveSession();
        // 根据游戏阶段恢复界面
        this.handleReconnected(data);
        break;

      case MSG.PLAYER_JOINED:
        Lobby.updatePlayerList(data.players);
        if (this.state === 'waiting') {
          const terminal = document.getElementById('terminal-content');
          const msg = data.reconnected
            ? `${data.player.name} 重新连接`
            : `${data.player.name} 加入了房间`;
          Lobby.addTerminalLine(terminal, msg, 'success');
        }
        break;

      case MSG.PLAYER_LEFT:
        if (data.players) {
          Lobby.updatePlayerList(data.players);
        }
        if (data.disconnected) {
          const terminal = document.getElementById('terminal-content');
          Lobby.addTerminalLine(terminal, `${data.name} 断开连接`, 'warning');
        }
        break;

      case MSG.GAME_STARTED:
        this.state = 'playing';
        this.saveSession();
        Game.onGameStarted(data);
        break;

      case MSG.PHASE_CHANGE:
        Game.onPhaseChange(data);
        if (data.players) {
          Lobby.updatePlayerList(data.players);
        }
        break;

      case MSG.DESCRIPTION_UPDATE:
        Game.onDescriptionUpdate(data);
        break;

      case MSG.VOTE_UPDATE:
        Game.onVoteUpdate(data);
        break;

      case MSG.VOTE_RESULT:
        Game.onVoteResult(data);
        break;

      case MSG.GAME_OVER:
        Game.onGameOver(data);
        this.state = 'gameover';
        this.saveSession();
        break;

      case MSG.ERROR:
        this.showError(data.message);
        // 如果重连失败，清除会话，回到大厅
        if (data.message.includes('房间已失效') || data.message.includes('重连失败')) {
          this.clearSession();
          this.playerId = null;
          this.roomCode = null;
          this.state = 'lobby';
          Lobby.show();
        }
        break;
    }
  },

  handleReconnected(data) {
    const terminal = document.getElementById('terminal-content');

    if (data.phase === 'WAITING') {
      this.state = 'waiting';
      Lobby.showWaitingRoom(data);
      Lobby.addTerminalLine(terminal, '已重新连接到房间', 'success');
    } else if (data.phase === 'GAME_OVER') {
      this.state = 'gameover';
      // 简单显示等待房间，房主可restart
      Lobby.showWaitingRoom(data);
      Lobby.addTerminalLine(terminal, '已重新连接（游戏已结束）', 'info');
    } else {
      // 游戏进行中 - 恢复到游戏界面
      this.state = 'playing';
      const editor = document.getElementById('editor-content');
      const tabName = document.getElementById('tab-name');
      tabName.textContent = `game_${data.roomCode}.js`;

      editor.innerHTML = '';
      Game.lineCount = 0;
      Game.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
      Game.addCodeLine(editor, '<span class="syntax-comment">// 重新连接成功</span>');
      Game.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
      Game.addCodeLine(editor, '');
      if (data.word) {
        Game.addCodeLine(editor, `<span class="syntax-keyword">const</span> <span class="syntax-variable">我的词语</span> <span class="syntax-operator">=</span> <span class="syntax-string">'${data.word}'</span><span class="syntax-operator">;</span>`);
      } else {
        Game.addCodeLine(editor, '<span class="syntax-keyword">const</span> <span class="syntax-variable">我的词语</span> <span class="syntax-operator">=</span> <span class="syntax-keyword">null</span><span class="syntax-operator">;</span> <span class="syntax-comment">// 你是白板</span>');
      }
      Game.addCodeLine(editor, `<span class="syntax-comment">// 当前第 ${data.round} 轮 - ${data.phase}</span>`);

      terminal.innerHTML = '';
      Lobby.addTerminalLine(terminal, '已重新连接到游戏', 'success');
      Lobby.addTerminalLine(terminal, `当前阶段: ${data.phase} | 第 ${data.round} 轮`, 'info');

      Lobby.updatePlayerList(data.players);
      document.getElementById('status-room').textContent = '📁 房间: ' + data.roomCode;
      document.getElementById('status-round').textContent = '第 ' + data.round + ' 轮';

      document.getElementById('terminal-input-line').style.display = 'none';
    }
  },

  showError(msg) {
    const terminal = document.getElementById('terminal-content');
    Lobby.addTerminalLine(terminal, `错误: ${msg}`, 'error');
  },

  initTerminalResize() {
    const resizeHandle = document.getElementById('terminal-resize');
    const terminalArea = document.getElementById('terminal-area');
    const editorPanel = document.querySelector('.editor-panel');
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const onStart = (y) => {
      isResizing = true;
      startY = y;
      startHeight = terminalArea.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    };

    const onMove = (y) => {
      if (!isResizing) return;
      const dy = startY - y;
      const newHeight = Math.max(80, Math.min(startHeight + dy, editorPanel.offsetHeight - 100));
      terminalArea.style.height = newHeight + 'px';
    };

    const onEnd = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    // Mouse events
    resizeHandle.addEventListener('mousedown', (e) => { onStart(e.clientY); e.preventDefault(); });
    document.addEventListener('mousemove', (e) => onMove(e.clientY));
    document.addEventListener('mouseup', onEnd);

    // Touch events
    resizeHandle.addEventListener('touchstart', (e) => { onStart(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', (e) => { if (isResizing) onMove(e.touches[0].clientY); }, { passive: true });
    document.addEventListener('touchend', onEnd);
  },

  initMobilePanels() {
    const sidebar = document.getElementById('sidebar');
    const historyPanel = document.getElementById('history-panel');
    const overlay = document.getElementById('panel-overlay');
    const hamburger = document.querySelector('.titlebar-left');
    const historyBtn = document.getElementById('mobile-history-btn');

    const closeAll = () => {
      sidebar.classList.remove('mobile-open');
      historyPanel.classList.remove('mobile-open');
      overlay.classList.remove('visible');
    };

    // 汉堡菜单切换侧边栏
    hamburger.addEventListener('click', () => {
      if (window.innerWidth > 600) return;
      const isOpen = sidebar.classList.contains('mobile-open');
      closeAll();
      if (!isOpen) {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('visible');
      }
    });

    // 历史按钮切换历史面板
    historyBtn.addEventListener('click', () => {
      const isOpen = historyPanel.classList.contains('mobile-open');
      closeAll();
      if (!isOpen) {
        historyPanel.classList.add('mobile-open');
        overlay.classList.add('visible');
      }
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', closeAll);
  },

  bindTerminalInput() {
    const input = document.getElementById('terminal-input');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const value = input.value.trim();
      if (!value) return;
      input.value = '';

      this.handleCommand(value);
    });
  },

  handleCommand(value) {
    const cmd = value.toLowerCase();

    // 大厅命令
    if (this.state === 'lobby') {
      if (cmd === 'create') {
        Lobby.showCreateForm();
      } else if (cmd === 'join') {
        Lobby.showJoinForm();
      } else {
        this.showError('未知命令。输入 create 创建房间，或 join 加入房间');
      }
      return;
    }

    // 等待房间命令
    if (this.state === 'waiting') {
      if (cmd === 'start') {
        if (!this.isHost) {
          this.showError('只有房主可以开始游戏');
          return;
        }
        this.send(MSG.START_GAME);
      } else {
        this.showError('等待中... 房主输入 start 开始游戏');
      }
      return;
    }

    // 游戏中命令
    if (this.state === 'playing') {
      if (Game.currentPhase === PHASE.DESCRIBING) {
        if (Game.hasSubmittedDescription) {
          this.showError('你已经提交过描述了，请等待其他人');
          return;
        }
        if (!Game.currentSpeaker || Game.currentSpeaker.id !== this.playerId) {
          this.showError('还没有轮到你发言');
          return;
        }
        this.send(MSG.SUBMIT_DESCRIPTION, { text: value });
        Game.hasSubmittedDescription = true;
        const terminal = document.getElementById('terminal-content');
        Lobby.addTerminalLine(terminal, `你的描述: "${value}"`, 'success');
        document.getElementById('terminal-input').placeholder = '等待中...';
        Game.showTerminalInput(false);
      } else if (Game.currentPhase === PHASE.ROUND_RESULT) {
        if (cmd === 'next' && this.isHost) {
          this.send(MSG.NEXT_ROUND);
        }
      }
      return;
    }

    // 游戏结束
    if (this.state === 'gameover') {
      if (cmd === 'restart' && this.isHost) {
        this.send(MSG.RESTART_GAME);
        this.state = 'waiting';
      }
      return;
    }
  },
};

// 启动
document.addEventListener('DOMContentLoaded', () => App.init());
