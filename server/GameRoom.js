const { PHASE, ROLE, pack, MSG } = require('./protocol');
const { getRandomPair } = require('./words');

let nextPlayerId = 1;

class GameRoom {
  constructor(roomCode, hostWs, hostName, settings) {
    this.roomCode = roomCode;
    this.settings = {
      maxPlayers: settings.maxPlayers || 6,
      spyCount: settings.spyCount || 1,
      blankCount: settings.blankCount || 0,
      difficulty: settings.difficulty || 'normal',
    };
    this.phase = PHASE.WAITING;
    this.round = 0;
    this.players = [];
    this.descriptions = new Map();   // playerId -> text
    this.votes = new Map();          // voterId -> targetId
    this.currentWords = null;        // { civilianWord, spyWord }
    this.speakingOrder = [];         // 本轮发言顺序 (player ID array)
    this.currentSpeakerIndex = 0;    // 当前发言者索引
    this.tiebreakPlayerIds = null;   // 平票加赛玩家ID列表（null表示正常轮次）

    // 添加房主
    this.addPlayer(hostWs, hostName, true);
  }

  addPlayer(ws, name, isHost = false) {
    const player = {
      id: nextPlayerId++,
      name,
      ws,
      isHost,
      role: null,
      word: null,
      alive: true,
    };
    this.players.push(player);
    ws._playerId = player.id;
    ws._roomCode = this.roomCode;
    return player;
  }

  // 标记玩家断线（不立即移除，保留重连机会）
  markDisconnected(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    player.ws = null;

    // 通知其他人
    this.broadcast(MSG.PLAYER_LEFT, {
      playerId,
      name: player.name,
      disconnected: true,
      players: this.getPlayersInfo(),
    });

    // 游戏中检查阶段完成
    if (this.phase !== PHASE.WAITING) {
      this.checkPhaseCompletion();
    }
  }

  // 重连玩家
  reconnectPlayer(playerId, ws) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return null;

    player.ws = ws;
    ws._playerId = player.id;
    ws._roomCode = this.roomCode;

    return { player };
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return null;
    const player = this.players[idx];
    this.players.splice(idx, 1);

    // 如果游戏进行中，标记为死亡而非移除
    if (this.phase !== PHASE.WAITING) {
      player.alive = false;
      player.ws = null;
      this.players.splice(idx, 0, player); // 放回去
      this.broadcast(MSG.PLAYER_LEFT, {
        playerId,
        name: player.name,
        disconnected: true,
        players: this.getPlayersInfo(),
      });
      this.checkPhaseCompletion();
      return player;
    }

    // 如果房主离开且还有人，转移房主
    if (player.isHost && this.players.length > 0) {
      this.players[0].isHost = true;
    }

    this.broadcast(MSG.PLAYER_LEFT, {
      playerId,
      name: player.name,
      players: this.getPlayersInfo(),
    });
    return player;
  }

  getPlayersInfo() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      alive: p.alive,
      role: this.phase === PHASE.GAME_OVER ? p.role : undefined,
    }));
  }

  getAlivePlayers() {
    return this.players.filter(p => p.alive);
  }

  broadcast(type, data, excludeId = null) {
    const msg = pack(type, data);
    this.players.forEach(p => {
      if (p.ws && p.id !== excludeId) {
        try { p.ws.send(msg); } catch {}
      }
    });
  }

  sendTo(playerId, type, data) {
    const player = this.players.find(p => p.id === playerId);
    if (player && player.ws) {
      try { player.ws.send(pack(type, data)); } catch {}
    }
  }

  // ========== 游戏流程 ==========

  startGame() {
    if (this.phase !== PHASE.WAITING) return { error: '游戏已经开始了' };

    const totalNeeded = this.settings.spyCount + this.settings.blankCount + 1;
    if (this.players.length < Math.max(4, totalNeeded + 1)) {
      return { error: `至少需要 ${Math.max(4, totalNeeded + 1)} 名玩家` };
    }
    if (this.players.length > this.settings.maxPlayers) {
      return { error: '玩家人数超出上限' };
    }

    // 分配角色
    this.currentWords = getRandomPair(this.settings.difficulty);
    const indices = this.players.map((_, i) => i);
    this.shuffle(indices);

    for (let i = 0; i < this.settings.spyCount; i++) {
      const p = this.players[indices[i]];
      p.role = ROLE.SPY;
      p.word = this.currentWords.spyWord;
    }
    for (let i = this.settings.spyCount; i < this.settings.spyCount + this.settings.blankCount; i++) {
      const p = this.players[indices[i]];
      p.role = ROLE.BLANK;
      p.word = null;
    }
    for (let i = this.settings.spyCount + this.settings.blankCount; i < indices.length; i++) {
      const p = this.players[indices[i]];
      p.role = ROLE.CIVILIAN;
      p.word = this.currentWords.civilianWord;
    }

    this.players.forEach(p => { p.alive = true; });
    this.round = 0;

    this.players.forEach(p => {
      this.sendTo(p.id, MSG.GAME_STARTED, {
        word: p.word,
        players: this.getPlayersInfo(),
        settings: this.settings,
      });
    });

    this.startDescriptionPhase();
    return { ok: true };
  }

  startDescriptionPhase() {
    const isTiebreak = this.tiebreakPlayerIds !== null;

    if (!isTiebreak) {
      this.round++;
    }

    this.descriptions.clear();
    this.phase = PHASE.DESCRIBING;

    if (isTiebreak) {
      // 加赛：只让平票的玩家发言
      const ids = this.tiebreakPlayerIds.filter(id => {
        const p = this.players.find(pl => pl.id === id);
        return p && p.alive && p.ws;
      });
      this.shuffle(ids);
      this.speakingOrder = ids;
    } else {
      // 正常轮次：所有存活玩家
      const alive = this.getAlivePlayers();
      const ids = alive.map(p => p.id);
      this.shuffle(ids);
      if (Math.random() < 0.5) ids.reverse();
      this.speakingOrder = ids;
    }

    this.currentSpeakerIndex = 0;

    // 跳过断线玩家
    this.skipInvalidSpeakers();

    const speakingOrderInfo = this.speakingOrder.map(id => {
      const p = this.players.find(pl => pl.id === id);
      return { id: p.id, name: p.name };
    });

    let currentSpeaker = null;
    if (this.currentSpeakerIndex < this.speakingOrder.length) {
      const currentId = this.speakingOrder[this.currentSpeakerIndex];
      const currentPlayer = this.players.find(p => p.id === currentId);
      currentSpeaker = { id: currentPlayer.id, name: currentPlayer.name };
    }

    this.broadcast(MSG.PHASE_CHANGE, {
      phase: PHASE.DESCRIBING,
      round: this.round,
      speakingOrder: speakingOrderInfo,
      currentSpeaker: currentSpeaker,
      isTiebreak: isTiebreak,
      tiebreakPlayerIds: isTiebreak ? this.tiebreakPlayerIds : undefined,
    });
  }

  submitDescription(playerId, text) {
    if (this.phase !== PHASE.DESCRIBING) return { error: '当前不是描述阶段' };
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '你已出局' };

    if (this.speakingOrder[this.currentSpeakerIndex] !== playerId) {
      return { error: '还没有轮到你发言' };
    }

    this.descriptions.set(playerId, text);
    this.currentSpeakerIndex++;
    this.skipInvalidSpeakers();

    const alive = this.getAlivePlayers();
    const isLast = this.currentSpeakerIndex >= this.speakingOrder.length;

    let nextSpeaker = null;
    if (!isLast) {
      const nextId = this.speakingOrder[this.currentSpeakerIndex];
      const nextPlayer = this.players.find(p => p.id === nextId);
      nextSpeaker = { id: nextPlayer.id, name: nextPlayer.name };
    }

    // 立即广播描述给所有玩家
    this.broadcast(MSG.DESCRIPTION_UPDATE, {
      playerId,
      playerName: player.name,
      text: text,
      submitted: this.descriptions.size,
      total: alive.length,
      nextSpeaker: nextSpeaker,
      isLast: isLast,
      round: this.round,
    });

    if (isLast) {
      this.startVotingPhase();
    }

    return { ok: true };
  }

  skipInvalidSpeakers() {
    while (this.currentSpeakerIndex < this.speakingOrder.length) {
      const id = this.speakingOrder[this.currentSpeakerIndex];
      const player = this.players.find(p => p.id === id);
      if (player && player.alive && player.ws) break;
      this.currentSpeakerIndex++;
    }
  }

  startVotingPhase() {
    this.votes.clear();
    this.phase = PHASE.VOTING;

    const isTiebreak = this.tiebreakPlayerIds !== null;
    const alivePlayers = this.getAlivePlayers().map(p => ({ id: p.id, name: p.name }));

    // 加赛时只能投票平票的玩家
    let voteablePlayers;
    if (isTiebreak) {
      voteablePlayers = alivePlayers.filter(p => this.tiebreakPlayerIds.includes(p.id));
    } else {
      voteablePlayers = alivePlayers;
    }

    this.broadcast(MSG.PHASE_CHANGE, {
      phase: PHASE.VOTING,
      round: this.round,
      alivePlayers,
      voteablePlayers: isTiebreak ? voteablePlayers : undefined,
      isTiebreak: isTiebreak,
    });
  }

  submitVote(voterId, targetId) {
    if (this.phase !== PHASE.VOTING) return { error: '当前不是投票阶段' };
    const voter = this.players.find(p => p.id === voterId);
    if (!voter || !voter.alive) return { error: '你已出局' };
    if (this.votes.has(voterId)) return { error: '你已经投过票了' };
    if (voterId === targetId) return { error: '不能投自己' };
    const target = this.players.find(p => p.id === targetId);
    if (!target || !target.alive) return { error: '目标玩家不存在或已出局' };

    // 加赛时只能投票平票玩家
    if (this.tiebreakPlayerIds && !this.tiebreakPlayerIds.includes(targetId)) {
      return { error: '加赛中只能投票给平票的玩家' };
    }

    this.votes.set(voterId, targetId);

    const alive = this.getAlivePlayers();
    this.broadcast(MSG.VOTE_UPDATE, {
      submitted: this.votes.size,
      total: alive.length,
    });

    if (this.votes.size >= alive.length) {
      this.resolveVotes();
    }

    return { ok: true };
  }

  resolveVotes() {
    const voteCount = new Map();
    this.votes.forEach((targetId) => {
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    });

    let maxVotes = 0;
    voteCount.forEach(count => { if (count > maxVotes) maxVotes = count; });

    const topVoted = [];
    voteCount.forEach((count, playerId) => {
      if (count === maxVotes) topVoted.push(playerId);
    });

    const voteDetails = {};
    this.votes.forEach((targetId, voterId) => {
      const voter = this.players.find(p => p.id === voterId);
      const target = this.players.find(p => p.id === targetId);
      if (voter && target) {
        voteDetails[voter.name] = target.name;
      }
    });

    this.phase = PHASE.ROUND_RESULT;

    if (topVoted.length > 1) {
      // 平票 → 设置加赛玩家
      this.tiebreakPlayerIds = topVoted;

      const tiePlayerNames = topVoted.map(id => {
        const p = this.players.find(pl => pl.id === id);
        return p ? p.name : '';
      });

      this.broadcast(MSG.VOTE_RESULT, {
        eliminated: null,
        tie: true,
        voteDetails,
        round: this.round,
        tiebreakPlayers: tiePlayerNames,
      });

      // 平票后直接进入加赛描述阶段（由房主点击触发或自动）
      this.broadcast(MSG.PHASE_CHANGE, {
        phase: PHASE.ROUND_RESULT,
        round: this.round,
        canNextRound: true,
        isTiebreak: true,
        tiebreakPlayers: tiePlayerNames,
      });
    } else {
      // 成功淘汰 → 清除加赛状态
      this.tiebreakPlayerIds = null;

      const eliminatedId = topVoted[0];
      const eliminated = this.players.find(p => p.id === eliminatedId);
      eliminated.alive = false;

      this.broadcast(MSG.VOTE_RESULT, {
        eliminated: {
          id: eliminated.id,
          name: eliminated.name,
          role: eliminated.role,
        },
        tie: false,
        voteDetails,
        round: this.round,
      });

      const result = this.checkWinCondition();
      if (result) {
        this.phase = PHASE.GAME_OVER;
        this.broadcast(MSG.GAME_OVER, {
          winner: result.winner,
          reason: result.reason,
          roles: this.players.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role,
            word: p.word,
            alive: p.alive,
          })),
          civilianWord: this.currentWords.civilianWord,
          spyWord: this.currentWords.spyWord,
        });
        return;
      }

      this.broadcast(MSG.PHASE_CHANGE, {
        phase: PHASE.ROUND_RESULT,
        round: this.round,
        canNextRound: true,
      });
    }
  }

  checkWinCondition() {
    const alive = this.getAlivePlayers();
    const aliveSpies = alive.filter(p => p.role === ROLE.SPY);
    const aliveBlanks = alive.filter(p => p.role === ROLE.BLANK);
    const aliveCivilians = alive.filter(p => p.role === ROLE.CIVILIAN);

    if (aliveSpies.length === 0) {
      if (aliveBlanks.length > 0) {
        return { winner: 'BLANK', reason: '卧底全部出局，白板存活，白板获胜！' };
      }
      return { winner: 'CIVILIAN', reason: '所有卧底已被淘汰，平民获胜！' };
    }

    if (aliveSpies.length >= aliveCivilians.length + aliveBlanks.length) {
      return { winner: 'SPY', reason: '卧底人数已不少于其他玩家，卧底获胜！' };
    }

    return null;
  }

  nextRound() {
    if (this.phase !== PHASE.ROUND_RESULT) return { error: '当前不能开始下一轮' };
    this.startDescriptionPhase();
    return { ok: true };
  }

  restartGame() {
    this.phase = PHASE.WAITING;
    this.round = 0;
    this.descriptions.clear();
    this.votes.clear();
    this.currentWords = null;
    this.speakingOrder = [];
    this.currentSpeakerIndex = 0;
    this.tiebreakPlayerIds = null;
    this.players.forEach(p => {
      p.role = null;
      p.word = null;
      p.alive = true;
    });
    this.players = this.players.filter(p => p.ws !== null);

    this.broadcast(MSG.PHASE_CHANGE, {
      phase: PHASE.WAITING,
      players: this.getPlayersInfo(),
    });
    return { ok: true };
  }

  checkPhaseCompletion() {
    if (this.phase === PHASE.DESCRIBING) {
      const oldIndex = this.currentSpeakerIndex;
      this.skipInvalidSpeakers();

      if (this.currentSpeakerIndex >= this.speakingOrder.length) {
        this.startVotingPhase();
      } else if (this.currentSpeakerIndex !== oldIndex) {
        const nextId = this.speakingOrder[this.currentSpeakerIndex];
        const nextPlayer = this.players.find(p => p.id === nextId);
        this.broadcast(MSG.DESCRIPTION_UPDATE, {
          skipped: true,
          nextSpeaker: { id: nextPlayer.id, name: nextPlayer.name },
          submitted: this.descriptions.size,
          total: this.getAlivePlayers().filter(p => p.ws).length,
          round: this.round,
        });
      }
    } else if (this.phase === PHASE.VOTING) {
      const alive = this.getAlivePlayers().filter(p => p.ws !== null);
      const allVoted = alive.every(p => this.votes.has(p.id));
      if (allVoted) this.resolveVotes();
    }
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = GameRoom;
