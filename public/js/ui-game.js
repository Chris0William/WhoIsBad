// 游戏界面管理
const Game = {
  lineCount: 0,
  myWord: null,
  currentPhase: null,
  currentRound: 0,
  speakingOrder: [],        // [{id, name}]
  currentSpeaker: null,     // {id, name}
  currentRoundDescriptions: [], // 当前轮描述（实时收集）
  roundDescriptions: [],    // 已完成轮次的描述记录
  roundVotes: [],           // 已完成轮次的投票记录
  hasSubmittedDescription: false,
  hasVoted: false,
  isTiebreak: false,

  reset() {
    this.lineCount = 0;
    this.myWord = null;
    this.currentPhase = null;
    this.currentRound = 0;
    this.speakingOrder = [];
    this.currentSpeaker = null;
    this.currentRoundDescriptions = [];
    this.roundDescriptions = [];
    this.roundVotes = [];
    this.hasSubmittedDescription = false;
    this.hasVoted = false;
    this.isTiebreak = false;
  },

  // 游戏开始
  onGameStarted(data) {
    this.reset();
    this.myWord = data.word;

    const editor = document.getElementById('editor-content');
    const tabName = document.getElementById('tab-name');

    tabName.textContent = `game_${App.roomCode}.js`;

    editor.innerHTML = '';
    this.lineCount = 0;

    this.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
    this.addCodeLine(editor, '<span class="syntax-comment">//   游戏开始！</span>');
    this.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
    this.addCodeLine(editor, '');

    if (!data.word) {
      this.addCodeLine(editor, '<span class="syntax-keyword">const</span> <span class="syntax-variable">我的词语</span> <span class="syntax-operator">=</span> <span class="syntax-keyword">undefined</span><span class="syntax-operator">;</span> <span class="syntax-comment">// 你没有收到词语</span>');
    } else {
      this.addCodeLine(editor, `<span class="syntax-keyword">const</span> <span class="syntax-variable">我的词语</span> <span class="syntax-operator">=</span> <span class="syntax-string">'${data.word}'</span><span class="syntax-operator">;</span> <span class="syntax-comment">// 描述它，但不要直接说出来</span>`);
    }

    this.addCodeLine(editor, '<span class="syntax-comment">// 注意：你不知道自己是平民还是卧底，请通过发言来判断</span>');
    this.addCodeLine(editor, '');

    Lobby.updatePlayerList(data.players);

    // 显示历史面板
    document.getElementById('history-panel').classList.add('visible');
    this.updateHistoryPanel();
  },

  // 阶段切换
  onPhaseChange(data) {
    this.currentPhase = data.phase;
    this.isTiebreak = data.isTiebreak || false;
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');

    document.getElementById('status-phase').textContent = this.getPhaseText(data.phase);
    if (data.round) {
      document.getElementById('status-round').textContent = '第 ' + data.round + ' 轮';
      this.currentRound = data.round;
    }

    switch (data.phase) {
      case PHASE.DESCRIBING: {
        this.hasSubmittedDescription = false;
        this.currentRoundDescriptions = [];
        this.speakingOrder = data.speakingOrder || [];
        this.currentSpeaker = data.currentSpeaker || null;

        const phaseLabel = data.isTiebreak
          ? `第 ${data.round} 轮 · 加赛描述`
          : `第 ${data.round} 轮 · 描述阶段`;
        this.addCodeLine(editor, `<span class="syntax-comment">// ---- ${phaseLabel} ----</span>`, 'system-msg');

        if (data.isTiebreak) {
          this.addCodeLine(editor, '<span class="syntax-warning">// ⚠ 平票加赛：仅平票玩家需发言，所有人投票</span>');
        }

        // 在编辑器中显示发言顺序
        const orderNames = this.speakingOrder.map(p => {
          const isMe = p.id === App.playerId;
          return isMe ? `<span class="syntax-type">${p.name}(我)</span>` : `<span class="syntax-function">${p.name}</span>`;
        }).join('<span class="syntax-operator"> → </span>');
        this.addCodeLine(editor, `<span class="syntax-comment">// 发言顺序:</span> ${orderNames}`);
        this.addCodeLine(editor, '');

        terminal.innerHTML = '';
        const termPhaseLabel = data.isTiebreak
          ? `--- 第 ${data.round} 轮 加赛描述 ---`
          : `--- 第 ${data.round} 轮 描述阶段 ---`;
        Lobby.addTerminalLine(terminal, termPhaseLabel, 'info');

        if (data.isTiebreak) {
          Lobby.addTerminalLine(terminal, '平票加赛：仅平票玩家发言，所有人投票', 'warning');
        }

        // 显示发言顺序
        const orderText = this.speakingOrder.map(p => p.id === App.playerId ? `[${p.name}(我)]` : p.name).join(' → ');
        Lobby.addTerminalLine(terminal, `发言顺序: ${orderText}`, '');

        // 判断是否轮到自己
        if (this.currentSpeaker && this.currentSpeaker.id === App.playerId) {
          Notify.send('轮到你发言', data.isTiebreak ? '加赛！请输入你的描述' : '请输入你的描述');
          Lobby.addTerminalLine(terminal, '轮到你发言了！请输入你的描述：', 'success');
          this.showTerminalInput(true);
          document.getElementById('terminal-input').placeholder = '输入你的描述...';
          document.getElementById('terminal-input').focus();
        } else if (this.currentSpeaker) {
          Lobby.addTerminalLine(terminal, `等待 ${this.currentSpeaker.name} 发言...`, '');
          this.showTerminalInput(false);
        }
        break;
      }

      case PHASE.VOTING: {
        this.hasVoted = false;
        // 保存当前轮描述到历史
        if (this.currentRoundDescriptions.length > 0) {
          this.roundDescriptions.push({
            round: data.round,
            descriptions: [...this.currentRoundDescriptions],
            isTiebreak: data.isTiebreak || false,
          });
          this.currentRoundDescriptions = [];
        }

        const voteLabel = data.isTiebreak
          ? `第 ${data.round} 轮 · 加赛投票`
          : `第 ${data.round} 轮 · 投票阶段`;
        Notify.send('投票阶段', data.isTiebreak ? '加赛投票！选择要淘汰的玩家' : '选择你要投票淘汰的玩家');
        this.addCodeLine(editor, '');
        this.addCodeLine(editor, `<span class="syntax-comment">// ---- ${voteLabel} ----</span>`, 'system-msg');
        if (data.isTiebreak) {
          this.addCodeLine(editor, '<span class="syntax-warning">// ⚠ 只能投票给平票的玩家</span>');
        }
        terminal.innerHTML = '';
        Lobby.addTerminalLine(terminal, `--- ${voteLabel} ---`, 'info');
        if (data.isTiebreak) {
          Lobby.addTerminalLine(terminal, '加赛：只能投票给平票的玩家', 'warning');
        }
        Lobby.addTerminalLine(terminal, '选择你要投票淘汰的玩家：', '');

        // 加赛时用 voteablePlayers，否则用 alivePlayers
        const voteCandidates = data.voteablePlayers || data.alivePlayers;
        this.showVoteOptions(voteCandidates);
        this.showTerminalInput(false);
        this.updateHistoryPanel();
        break;
      }

      case PHASE.ROUND_RESULT:
        break;

      case PHASE.WAITING:
        this.reset();
        document.getElementById('history-panel').classList.remove('visible');
        Lobby.showWaitingRoom({
          roomCode: App.roomCode,
          players: data.players,
          settings: App.settings,
        });
        break;
    }

    this.scrollEditorToBottom();
  },

  // 实时收到某人的描述
  onDescriptionUpdate(data) {
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');

    // 如果是跳过消息（玩家断线）
    if (data.skipped) {
      this.currentSpeaker = data.nextSpeaker;
      if (this.currentSpeaker && this.currentSpeaker.id === App.playerId) {
        Notify.send('轮到你发言', '请输入你的描述');
        Lobby.addTerminalLine(terminal, '轮到你发言了！请输入你的描述：', 'success');
        this.showTerminalInput(true);
        document.getElementById('terminal-input').placeholder = '输入你的描述...';
        document.getElementById('terminal-input').focus();
      } else if (this.currentSpeaker) {
        Lobby.addTerminalLine(terminal, `等待 ${this.currentSpeaker.name} 发言...`, '');
      }
      return;
    }

    // 收到正常描述
    const isSelf = data.playerId === App.playerId;
    const nameClass = isSelf ? 'syntax-type' : 'syntax-function';
    this.addCodeLine(editor,
      `<span class="syntax-comment">//</span> <span class="${nameClass}">[${data.playerName}]</span> <span class="syntax-string">"${this.escapeHtml(data.text)}"</span>`,
      isSelf ? 'highlight' : ''
    );

    // 保存到当前轮描述记录
    this.currentRoundDescriptions.push({
      playerId: data.playerId,
      playerName: data.playerName,
      text: data.text,
    });

    // 更新当前发言者
    this.currentSpeaker = data.nextSpeaker;

    // 更新终端提示
    if (data.isLast) {
      // 所有人发言完毕，即将进入投票
      Lobby.addTerminalLine(terminal, `${data.playerName} 已发言 (${data.submitted}/${data.total})`, 'success');
      Lobby.addTerminalLine(terminal, '所有人已发言完毕，即将进入投票...', 'info');
      this.showTerminalInput(false);
    } else if (this.currentSpeaker && this.currentSpeaker.id === App.playerId) {
      // 轮到自己
      Notify.send('轮到你发言', '请输入你的描述');
      Lobby.addTerminalLine(terminal, `${data.playerName} 已发言 (${data.submitted}/${data.total})`, 'success');
      Lobby.addTerminalLine(terminal, '轮到你发言了！请输入你的描述：', 'success');
      this.hasSubmittedDescription = false;
      this.showTerminalInput(true);
      document.getElementById('terminal-input').placeholder = '输入你的描述...';
      document.getElementById('terminal-input').focus();
    } else {
      // 等待别人
      if (isSelf) {
        Lobby.addTerminalLine(terminal, `你已发言 (${data.submitted}/${data.total})`, 'success');
      } else {
        Lobby.addTerminalLine(terminal, `${data.playerName} 已发言 (${data.submitted}/${data.total})`, 'success');
      }
      if (this.currentSpeaker) {
        Lobby.addTerminalLine(terminal, `等待 ${this.currentSpeaker.name} 发言...`, '');
      }
      this.showTerminalInput(false);
    }

    this.scrollEditorToBottom();
    this.updateHistoryPanel();
  },

  // 投票进度
  onVoteUpdate(data) {
    const terminal = document.getElementById('terminal-content');
    const existing = terminal.querySelector('.vote-progress');
    if (existing) {
      existing.textContent = `投票进度: ${data.submitted}/${data.total}`;
    } else {
      const line = Lobby.addTerminalLine(terminal, `投票进度: ${data.submitted}/${data.total}`, 'info');
      line.classList.add('vote-progress');
    }
  },

  // 投票结果
  onVoteResult(data) {
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');

    this.roundVotes.push({
      round: data.round,
      voteDetails: data.voteDetails,
      eliminated: data.eliminated,
      tie: data.tie,
    });

    this.addCodeLine(editor, '');

    this.addCodeLine(editor, '<span class="syntax-keyword">const</span> <span class="syntax-variable">投票结果</span> <span class="syntax-operator">=</span> <span class="syntax-operator">{</span>');
    if (data.voteDetails) {
      Object.entries(data.voteDetails).forEach(([voter, target]) => {
        this.addCodeLine(editor,
          `  <span class="syntax-function">${voter}</span><span class="syntax-operator">:</span> <span class="syntax-string">"投给 ${target}"</span><span class="syntax-operator">,</span>`
        );
      });
    }
    this.addCodeLine(editor, '<span class="syntax-operator">}</span><span class="syntax-operator">;</span>');

    if (data.tie) {
      const tieNames = data.tiebreakPlayers ? data.tiebreakPlayers.join('、') : '';
      this.addCodeLine(editor,
        `<span class="syntax-function">console</span><span class="syntax-operator">.</span><span class="syntax-function">warn</span><span class="syntax-operator">(</span><span class="syntax-string">"平票！${tieNames} 需要加赛"</span><span class="syntax-operator">);</span>`,
        'system-msg'
      );
      terminal.innerHTML = '';
      Lobby.addTerminalLine(terminal, `平票！${tieNames} 需要加赛`, 'warning');
    } else if (data.eliminated) {
      const roleColor = data.eliminated.role === 'SPY' ? 'syntax-error' :
                         data.eliminated.role === 'BLANK' ? 'syntax-warning' : 'syntax-type';
      this.addCodeLine(editor,
        `<span class="syntax-function">console</span><span class="syntax-operator">.</span><span class="syntax-function">log</span><span class="syntax-operator">(</span><span class="syntax-string">"${data.eliminated.name} 被淘汰"</span><span class="syntax-operator">,</span> <span class="${roleColor}">"${ROLE_NAME[data.eliminated.role]}"</span><span class="syntax-operator">);</span>`,
        'system-msg'
      );
      terminal.innerHTML = '';
      Lobby.addTerminalLine(terminal, `${data.eliminated.name} 被淘汰了！身份：${ROLE_NAME[data.eliminated.role]}`, 'warning');
    }

    if (App.isHost) {
      Lobby.addTerminalLine(terminal, '', '');
      const options = document.createElement('div');
      options.className = 'terminal-options';
      const btnNext = document.createElement('button');
      btnNext.className = 'terminal-option-btn';
      btnNext.textContent = data.tie ? '> 开始加赛' : '> 下一轮';
      btnNext.onclick = () => App.send(MSG.NEXT_ROUND);
      options.appendChild(btnNext);
      terminal.appendChild(options);
      this.showTerminalInput(false);
    } else {
      Lobby.addTerminalLine(terminal, data.tie ? '等待房主开始加赛...' : '等待房主开始下一轮...', 'info');
      this.showTerminalInput(false);
    }

    this.scrollEditorToBottom();
    this.updateHistoryPanel();
  },

  // 游戏结束
  onGameOver(data) {
    this.currentPhase = PHASE.GAME_OVER;
    const winnerText = data.winner === 'SPY' ? '卧底' : data.winner === 'BLANK' ? '白板' : '平民';
    Notify.send('游戏结束', `${winnerText}获胜！`);
    const editor = document.getElementById('editor-content');
    const terminal = document.getElementById('terminal-content');

    this.addCodeLine(editor, '');
    this.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
    this.addCodeLine(editor, '<span class="syntax-comment">//   游戏结束！</span>');
    this.addCodeLine(editor, '<span class="syntax-comment">// ================================</span>');
    this.addCodeLine(editor, '');

    const winnerName = data.winner === 'SPY' ? '卧底' : data.winner === 'BLANK' ? '白板' : '平民';
    this.addCodeLine(editor,
      `<span class="syntax-keyword">const</span> <span class="syntax-variable">获胜方</span> <span class="syntax-operator">=</span> <span class="syntax-string">'${winnerName} 获胜！'</span><span class="syntax-operator">;</span>`
    );
    this.addCodeLine(editor,
      `<span class="syntax-function">console</span><span class="syntax-operator">.</span><span class="syntax-function">log</span><span class="syntax-operator">(</span><span class="syntax-string">"${data.reason}"</span><span class="syntax-operator">);</span>`,
      'system-msg'
    );

    this.addCodeLine(editor, '');
    this.addCodeLine(editor, '<span class="syntax-keyword">const</span> <span class="syntax-variable">所有身份</span> <span class="syntax-operator">=</span> <span class="syntax-operator">{</span>');
    data.roles.forEach(p => {
      const roleColor = p.role === 'SPY' ? 'syntax-error' :
                         p.role === 'BLANK' ? 'syntax-warning' : 'syntax-type';
      const status = p.alive ? '存活' : '出局';
      this.addCodeLine(editor,
        `  <span class="syntax-function">${p.name}</span><span class="syntax-operator">:</span> { <span class="syntax-variable">身份</span>: <span class="${roleColor}">"${ROLE_NAME[p.role]}"</span>, <span class="syntax-variable">词语</span>: <span class="syntax-string">"${p.word || '无'}"</span>, <span class="syntax-variable">状态</span>: <span class="syntax-string">"${status}"</span> }<span class="syntax-operator">,</span>`
      );
    });
    this.addCodeLine(editor, '<span class="syntax-operator">}</span><span class="syntax-operator">;</span>');

    this.addCodeLine(editor, '');
    this.addCodeLine(editor,
      `<span class="syntax-comment">// 平民词: ${data.civilianWord}  |  卧底词: ${data.spyWord}</span>`
    );

    // 终端
    terminal.innerHTML = '';
    Lobby.addTerminalLine(terminal, `游戏结束！${winnerName}获胜！`, 'success');
    Lobby.addTerminalLine(terminal, data.reason, 'info');
    Lobby.addTerminalLine(terminal, '', '');

    if (App.isHost) {
      const options = document.createElement('div');
      options.className = 'terminal-options';
      const btnRestart = document.createElement('button');
      btnRestart.className = 'terminal-option-btn';
      btnRestart.textContent = '> 重新开始';
      btnRestart.onclick = () => {
        App.send(MSG.RESTART_GAME);
        App.state = 'waiting';
      };
      options.appendChild(btnRestart);
      terminal.appendChild(options);
      this.showTerminalInput(false);
    } else {
      Lobby.addTerminalLine(terminal, '等待房主重新开始...', 'info');
      this.showTerminalInput(false);
    }

    Lobby.updatePlayerList(data.roles);

    document.getElementById('status-phase').textContent = '游戏结束';
    this.scrollEditorToBottom();
    this.updateHistoryPanel();
  },

  // 显示投票选项
  showVoteOptions(alivePlayers) {
    const terminal = document.getElementById('terminal-content');
    const options = document.createElement('div');
    options.className = 'vote-options';

    alivePlayers.forEach(p => {
      if (p.id === App.playerId) return;
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = `> 投票淘汰 "${p.name}"`;
      btn.onclick = () => {
        if (this.hasVoted) return;
        this.hasVoted = true;
        App.send(MSG.SUBMIT_VOTE, { targetId: p.id });
        options.querySelectorAll('.vote-btn').forEach(b => {
          b.classList.remove('voted');
          b.disabled = true;
        });
        btn.classList.add('voted');
        btn.textContent = `> 投票淘汰 "${p.name}" ✓`;
        Lobby.addTerminalLine(terminal, `你投票给了 ${p.name}`, 'success');
      };
      options.appendChild(btn);
    });

    terminal.appendChild(options);
  },

  // 显示/隐藏终端输入
  showTerminalInput(show) {
    const inputLine = document.getElementById('terminal-input-line');
    inputLine.style.display = show ? 'flex' : 'none';
    if (show) {
      document.getElementById('terminal-input').value = '';
    }
  },

  // 更新右侧历史面板
  updateHistoryPanel() {
    const panel = document.getElementById('history-content');
    if (!panel) return;
    panel.innerHTML = '';

    // 已完成的轮次
    this.roundDescriptions.forEach((rd, i) => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'history-round';

      const header = document.createElement('div');
      header.className = 'history-round-header';
      header.textContent = rd.isTiebreak ? `▸ 第 ${rd.round} 轮 (加赛)` : `▸ 第 ${rd.round} 轮`;
      roundDiv.appendChild(header);

      // 发言
      const descTitle = document.createElement('div');
      descTitle.className = 'history-section-title';
      descTitle.textContent = '发言:';
      roundDiv.appendChild(descTitle);

      rd.descriptions.forEach(d => {
        const line = document.createElement('div');
        line.className = 'history-item';
        line.innerHTML = `<span class="history-name">${this.escapeHtml(d.playerName)}</span>: "${this.escapeHtml(d.text)}"`;
        roundDiv.appendChild(line);
      });

      // 投票
      if (this.roundVotes[i]) {
        const rv = this.roundVotes[i];
        const voteTitle = document.createElement('div');
        voteTitle.className = 'history-section-title';
        voteTitle.textContent = '投票:';
        roundDiv.appendChild(voteTitle);

        Object.entries(rv.voteDetails).forEach(([voter, target]) => {
          const line = document.createElement('div');
          line.className = 'history-item';
          line.textContent = `${voter} → ${target}`;
          roundDiv.appendChild(line);
        });

        const result = document.createElement('div');
        result.className = 'history-result';
        if (rv.tie) {
          result.textContent = '平票，无人淘汰';
        } else if (rv.eliminated) {
          result.textContent = `${rv.eliminated.name} 被淘汰 (${ROLE_NAME[rv.eliminated.role]})`;
        }
        roundDiv.appendChild(result);
      }

      panel.appendChild(roundDiv);
    });

    // 当前轮进行中的描述
    if (this.currentRoundDescriptions.length > 0) {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'history-round current';

      const header = document.createElement('div');
      header.className = 'history-round-header';
      header.textContent = `▸ 第 ${this.currentRound} 轮 (进行中)`;
      roundDiv.appendChild(header);

      const descTitle = document.createElement('div');
      descTitle.className = 'history-section-title';
      descTitle.textContent = '发言:';
      roundDiv.appendChild(descTitle);

      this.currentRoundDescriptions.forEach(d => {
        const line = document.createElement('div');
        line.className = 'history-item';
        line.innerHTML = `<span class="history-name">${this.escapeHtml(d.playerName)}</span>: "${this.escapeHtml(d.text)}"`;
        roundDiv.appendChild(line);
      });

      panel.appendChild(roundDiv);
    }

    panel.scrollTop = panel.scrollHeight;
  },

  getPhaseText(phase) {
    switch (phase) {
      case PHASE.WAITING: return '等待中';
      case PHASE.DESCRIBING: return this.isTiebreak ? '加赛描述' : '描述阶段';
      case PHASE.VOTING: return this.isTiebreak ? '加赛投票' : '投票阶段';
      case PHASE.ROUND_RESULT: return this.isTiebreak ? '加赛结算' : '结算中';
      case PHASE.GAME_OVER: return '游戏结束';
      default: return '';
    }
  },

  addCodeLine(container, content, extraClass) {
    this.lineCount++;
    const line = document.createElement('div');
    line.className = 'code-line' + (extraClass ? ' ' + extraClass : '');
    line.innerHTML = `<span class="line-number">${this.lineCount}</span><span class="line-content">${content || ''}</span>`;
    container.appendChild(line);
    return line;
  },

  scrollEditorToBottom() {
    const area = document.getElementById('editor-area');
    setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};
