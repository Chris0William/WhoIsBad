const DIFFICULTY_LABEL = { easy: '简单', normal: '普通', hard: '困难' };

// 大厅界面管理
const Lobby = {
  show() {
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');
    const tabName = document.getElementById('tab-name');
    const sidebarTitle = document.getElementById('sidebar-title');
    const playerList = document.getElementById('player-list');

    tabName.textContent = 'welcome.js';
    sidebarTitle.textContent = '▸ 工作区';
    playerList.innerHTML = '';

    // 隐藏复制链接按钮
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) copyBtn.style.display = 'none';

    // 编辑器区域显示欢迎信息
    editor.innerHTML = '';
    const lines = [
      { content: '<span class="syntax-comment">// ================================================</span>' },
      { content: '<span class="syntax-comment">//   欢迎使用 spy-editor</span>' },
      { content: '<span class="syntax-comment">//   一个完全正常的代码编辑器，没什么特别的。</span>' },
      { content: '<span class="syntax-comment">// ================================================</span>' },
      { content: '' },
      { content: '<span class="syntax-keyword">const</span> <span class="syntax-variable">game</span> <span class="syntax-operator">=</span> <span class="syntax-string">\'谁是卧底\'</span><span class="syntax-operator">;</span>' },
      { content: '' },
      { content: '<span class="syntax-comment">// 在下方终端输入命令开始游戏：</span>' },
      { content: '<span class="syntax-comment">//   输入 create  - 创建新房间</span>' },
      { content: '<span class="syntax-comment">//   输入 join    - 加入房间</span>' },
      { content: '' },
      { content: '<span class="syntax-keyword">function</span> <span class="syntax-function">startGame</span><span class="syntax-operator">()</span> <span class="syntax-operator">{</span>' },
      { content: '  <span class="syntax-keyword">return</span> <span class="syntax-string">\'准备好了吗？\'</span><span class="syntax-operator">;</span>' },
      { content: '<span class="syntax-operator">}</span>' },
    ];

    lines.forEach((line, i) => {
      this.addEditorLine(editor, i + 1, line.content);
    });

    // 终端显示提示 + 可点击选项
    terminal.innerHTML = '';
    this.addTerminalLine(terminal, '欢迎使用 spy-editor v1.0.0', 'info');
    this.addTerminalLine(terminal, '请选择操作：', '');

    const options = document.createElement('div');
    options.className = 'terminal-options';
    const btnCreate = document.createElement('button');
    btnCreate.className = 'terminal-option-btn';
    btnCreate.textContent = '> 创建房间';
    btnCreate.onclick = () => this.showCreateForm();

    const btnJoin = document.createElement('button');
    btnJoin.className = 'terminal-option-btn';
    btnJoin.textContent = '> 加入房间';
    btnJoin.onclick = () => this.showJoinForm();

    options.appendChild(btnCreate);
    options.appendChild(btnJoin);
    terminal.appendChild(options);

    // 隐藏终端输入
    document.getElementById('terminal-input-line').style.display = 'none';

    // 更新状态栏
    document.getElementById('status-room').textContent = '';
    document.getElementById('status-phase').textContent = '';
    document.getElementById('status-round').textContent = '';
  },

  showCreateForm() {
    const terminal = document.getElementById('terminal-content');
    terminal.innerHTML = '';
    this.addTerminalLine(terminal, '> create', '');
    this.addTerminalLine(terminal, '创建新房间 - 请填写以下信息：', 'info');

    const form = document.createElement('div');
    form.className = 'lobby-form';
    form.innerHTML = `
      <div class="form-line">
        <label class="syntax-keyword">你的名字</label>
        <span class="syntax-operator"> = </span>
        <input type="text" class="form-input" id="input-name" placeholder="输入昵称" maxlength="8">
      </div>
      <div class="form-line">
        <label class="syntax-keyword">房间号码</label>
        <span class="syntax-operator"> = </span>
        <input type="text" class="form-input" id="input-room-code" placeholder="留空则自动生成" maxlength="6" style="text-transform:uppercase">
      </div>
      <div class="form-line" style="margin-top:8px">
        <button class="form-btn" id="btn-create">创建房间</button>
        <button class="form-btn secondary" id="btn-back" style="margin-left:8px">返回</button>
      </div>
    `;
    terminal.appendChild(form);

    document.getElementById('terminal-input-line').style.display = 'none';

    document.getElementById('btn-create').onclick = () => {
      const name = document.getElementById('input-name').value.trim();
      if (!name) {
        this.addTerminalLine(terminal, '错误：请输入你的名字', 'error');
        return;
      }
      const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
      App.send(MSG.CREATE_ROOM, {
        playerName: name,
        roomCode: roomCode || undefined,
      });
    };

    document.getElementById('btn-back').onclick = () => this.show();
    document.getElementById('input-name').focus();
  },

  showJoinForm(prefilledRoom) {
    const terminal = document.getElementById('terminal-content');
    terminal.innerHTML = '';
    this.addTerminalLine(terminal, '> join', '');
    this.addTerminalLine(terminal, '加入房间 - 请填写以下信息：', 'info');

    const form = document.createElement('div');
    form.className = 'lobby-form';
    form.innerHTML = `
      <div class="form-line">
        <label class="syntax-keyword">你的名字</label>
        <span class="syntax-operator"> = </span>
        <input type="text" class="form-input" id="input-name" placeholder="输入昵称" maxlength="8">
      </div>
      <div class="form-line">
        <label class="syntax-keyword">房间代码</label>
        <span class="syntax-operator"> = </span>
        <input type="text" class="form-input" id="input-room" placeholder="房间代码" maxlength="6" style="text-transform:uppercase" value="${prefilledRoom || ''}">
      </div>
      <div class="form-line" style="margin-top:8px">
        <button class="form-btn" id="btn-join">加入房间</button>
        <button class="form-btn secondary" id="btn-back" style="margin-left:8px">返回</button>
      </div>
    `;
    terminal.appendChild(form);

    document.getElementById('terminal-input-line').style.display = 'none';

    document.getElementById('btn-join').onclick = () => {
      const name = document.getElementById('input-name').value.trim();
      const room = document.getElementById('input-room').value.trim().toUpperCase();
      if (!name) {
        this.addTerminalLine(terminal, '错误：请输入你的名字', 'error');
        return;
      }
      if (!room) {
        this.addTerminalLine(terminal, '错误：请输入房间代码', 'error');
        return;
      }
      App.send(MSG.JOIN_ROOM, { playerName: name, roomCode: room });
    };

    document.getElementById('btn-back').onclick = () => this.show();
    document.getElementById('input-name').focus();
  },

  // 进入等待房间
  showWaitingRoom(data) {
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');
    const tabName = document.getElementById('tab-name');
    const sidebarTitle = document.getElementById('sidebar-title');
    const settings = data.settings || App.settings;

    tabName.textContent = `room_${data.roomCode}.js`;
    sidebarTitle.textContent = '▸ 玩家列表';

    document.getElementById('status-room').textContent = '📁 房间: ' + data.roomCode;

    // 编辑器显示房间信息
    editor.innerHTML = '';
    const lines = [
      { content: '<span class="syntax-comment">// ================================</span>' },
      { content: '<span class="syntax-comment">//   房间已创建，等待玩家加入...</span>' },
      { content: '<span class="syntax-comment">// ================================</span>' },
      { content: '' },
      { content: `<span class="syntax-keyword">const</span> <span class="syntax-variable">房间代码</span> <span class="syntax-operator">=</span> <span class="syntax-string">'${data.roomCode}'</span><span class="syntax-operator">;</span> <span class="syntax-comment">// 分享给同事</span>` },
      { content: '' },
      { content: '<span class="syntax-comment">// 将房间代码或链接分享给同事，他们打开即可加入</span>' },
      { content: '<span class="syntax-comment">// 房主可在下方终端调整游戏设置</span>' },
    ];
    lines.forEach((line, i) => {
      this.addEditorLine(editor, i + 1, line.content);
    });

    // 复制链接按钮（放在标签栏右侧）
    let copyBtn = document.getElementById('copy-link-btn');
    if (!copyBtn) {
      copyBtn = document.createElement('button');
      copyBtn.id = 'copy-link-btn';
      copyBtn.className = 'copy-link-btn';
      copyBtn.textContent = '复制邀请链接';
      document.querySelector('.tabs-bar').appendChild(copyBtn);
    }
    copyBtn.style.display = 'inline-flex';
    const joinUrl = `${location.origin}?room=${data.roomCode}`;
    copyBtn.onclick = () => {
      this.copyText(joinUrl).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制邀请链接'; }, 2000);
      });
    };

    // 终端 - 房主显示设置面板，非房主显示等待
    terminal.innerHTML = '';
    this.addTerminalLine(terminal, `房间 ${data.roomCode} 已就绪`, 'success');
    this.addTerminalLine(terminal, '等待玩家加入中...', 'info');

    if (App.isHost) {
      this.renderSettingsPanel(terminal, settings);
    } else {
      this.renderSettingsReadonly(terminal, settings);
      this.addTerminalLine(terminal, '等待房主开始游戏...', '');
      const leaveOpts = document.createElement('div');
      leaveOpts.className = 'terminal-options';
      const btnLeave = document.createElement('button');
      btnLeave.className = 'terminal-option-btn';
      btnLeave.style.color = 'var(--text-error)';
      btnLeave.textContent = '> 退出房间';
      btnLeave.onclick = () => App.leaveRoom();
      leaveOpts.appendChild(btnLeave);
      terminal.appendChild(leaveOpts);
    }

    document.getElementById('terminal-input-line').style.display = 'none';

    // 更新玩家列表
    this.updatePlayerList(data.players);
  },

  // 房主设置面板
  renderSettingsPanel(terminal, settings) {
    // 移除旧面板
    const old = terminal.querySelector('.settings-panel');
    if (old) old.remove();
    const oldBtn = terminal.querySelector('.terminal-options');
    if (oldBtn) oldBtn.remove();

    const panel = document.createElement('div');
    panel.className = 'lobby-form settings-panel';
    panel.innerHTML = `
      <div class="form-line">
        <label class="syntax-keyword">最大人数</label>
        <span class="syntax-operator"> = </span>
        <input type="number" class="form-input" id="input-max" value="${settings.maxPlayers}" min="4" max="12">
      </div>
      <div class="form-line">
        <label class="syntax-keyword">卧底数量</label>
        <span class="syntax-operator"> = </span>
        <input type="number" class="form-input" id="input-spy" value="${settings.spyCount}" min="1" max="4">
      </div>
      <div class="form-line">
        <label class="syntax-keyword">白板数量</label>
        <span class="syntax-operator"> = </span>
        <input type="number" class="form-input" id="input-blank" value="${settings.blankCount}" min="0" max="3">
      </div>
      <div class="form-line">
        <label class="syntax-keyword">词语难度</label>
        <span class="syntax-operator"> = </span>
        <div class="difficulty-selector" id="difficulty-selector">
          <button class="difficulty-btn${settings.difficulty === 'easy' ? ' active' : ''}" data-value="easy">简单</button>
          <button class="difficulty-btn${settings.difficulty === 'normal' ? ' active' : ''}" data-value="normal">普通</button>
          <button class="difficulty-btn${settings.difficulty === 'hard' ? ' active' : ''}" data-value="hard">困难</button>
        </div>
      </div>
    `;
    terminal.appendChild(panel);

    // 难度选择按钮
    panel.querySelectorAll('.difficulty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sendSettingsUpdate();
      });
    });

    // 数值输入变化时发送更新
    panel.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener('change', () => this.sendSettingsUpdate());
    });

    // 开始游戏 + 退出房间按钮
    const options = document.createElement('div');
    options.className = 'terminal-options';
    const btnStart = document.createElement('button');
    btnStart.className = 'terminal-option-btn';
    btnStart.textContent = '> 开始游戏';
    btnStart.onclick = () => App.send(MSG.START_GAME);
    options.appendChild(btnStart);
    const btnLeave = document.createElement('button');
    btnLeave.className = 'terminal-option-btn';
    btnLeave.style.color = 'var(--text-error)';
    btnLeave.textContent = '> 退出房间';
    btnLeave.onclick = () => App.leaveRoom();
    options.appendChild(btnLeave);
    terminal.appendChild(options);
  },

  // 发送设置更新
  sendSettingsUpdate() {
    const activeBtn = document.querySelector('.difficulty-btn.active');
    App.send(MSG.UPDATE_SETTINGS, {
      maxPlayers: parseInt(document.getElementById('input-max').value) || 6,
      spyCount: parseInt(document.getElementById('input-spy').value) || 1,
      blankCount: parseInt(document.getElementById('input-blank').value) || 0,
      difficulty: activeBtn ? activeBtn.dataset.value : 'normal',
    });
  },

  // 非房主只读显示设置
  renderSettingsReadonly(terminal, settings) {
    const old = terminal.querySelector('.settings-readonly');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.className = 'lobby-form settings-readonly';
    panel.innerHTML = `
      <div class="form-line">
        <label class="syntax-comment">// 当前设置:</label>
      </div>
      <div class="form-line">
        <label class="syntax-keyword">最大人数</label>
        <span class="syntax-operator"> = </span>
        <span class="syntax-number">${settings.maxPlayers}</span>
      </div>
      <div class="form-line">
        <label class="syntax-keyword">卧底数量</label>
        <span class="syntax-operator"> = </span>
        <span class="syntax-number">${settings.spyCount}</span>
      </div>
      <div class="form-line">
        <label class="syntax-keyword">白板数量</label>
        <span class="syntax-operator"> = </span>
        <span class="syntax-number">${settings.blankCount}</span>
      </div>
      <div class="form-line">
        <label class="syntax-keyword">词语难度</label>
        <span class="syntax-operator"> = </span>
        <span class="syntax-string">'${DIFFICULTY_LABEL[settings.difficulty] || '普通'}'</span>
      </div>
    `;
    terminal.appendChild(panel);
  },

  // 设置更新时刷新显示
  onSettingsUpdated(settings) {
    App.settings = settings;
    const terminal = document.getElementById('terminal-content');
    if (App.isHost) {
      // 房主端更新输入值（防止服务端修正后的值不同步）
      const maxInput = document.getElementById('input-max');
      const spyInput = document.getElementById('input-spy');
      const blankInput = document.getElementById('input-blank');
      if (maxInput) maxInput.value = settings.maxPlayers;
      if (spyInput) spyInput.value = settings.spyCount;
      if (blankInput) blankInput.value = settings.blankCount;
    } else {
      // 非房主刷新只读面板
      this.renderSettingsReadonly(terminal, settings);
    }
  },

  updatePlayerList(players) {
    const list = document.getElementById('player-list');
    const sidebarTitle = document.getElementById('sidebar-title');
    sidebarTitle.textContent = `▸ 玩家列表 (${players.length})`;
    list.innerHTML = '';
    players.forEach(p => {
      const item = document.createElement('div');
      item.className = 'player-item' + (p.id === App.playerId ? ' is-self' : '') + (!p.alive ? ' eliminated' : '');
      let roleClass = '';
      let roleText = '';
      if (p.role) {
        roleClass = p.role === 'SPY' ? ' is-spy' : p.role === 'BLANK' ? ' is-blank' : ' is-civilian';
        roleText = ROLE_NAME[p.role];
      }
      if (p.role) item.className += roleClass;
      item.innerHTML = `
        <span class="player-icon">${p.alive ? '📄' : '🗑️'}</span>
        <span>${p.name}</span>
        ${p.isHost ? '<span class="player-badge host">房主</span>' : ''}
        ${roleText ? `<span class="player-badge">${roleText}</span>` : ''}
      `;
      list.appendChild(item);
    });
  },

  addEditorLine(container, lineNum, content) {
    const line = document.createElement('div');
    line.className = 'code-line';
    line.innerHTML = `<span class="line-number">${lineNum}</span><span class="line-content">${content || ''}</span>`;
    container.appendChild(line);
    return line;
  },

  addTerminalLine(container, text, type) {
    const line = document.createElement('div');
    line.className = 'terminal-line' + (type ? ' ' + type : '');
    line.textContent = text;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    return line;
  },

  // 兼容移动端的复制方法
  copyText(text) {
    // 优先使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => this._fallbackCopy(text));
    }
    return this._fallbackCopy(text);
  },

  _fallbackCopy(text) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.setAttribute('readonly', '');
      input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      input.value = text;
      document.body.appendChild(input);
      // iOS Safari 需要 setSelectionRange
      input.focus();
      input.setSelectionRange(0, text.length);
      document.execCommand('copy');
      document.body.removeChild(input);
      resolve();
    });
  },
};
