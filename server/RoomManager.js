const GameRoom = require('./GameRoom');
const { MSG, pack, unpack } = require('./protocol');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> GameRoom
    this.roomDestroyTimers = new Map(); // roomCode -> timer
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  handleMessage(ws, rawMessage) {
    const msg = unpack(rawMessage);
    if (!msg) {
      ws.send(pack(MSG.ERROR, { message: '消息格式错误' }));
      return;
    }

    const { type, data } = msg;

    switch (type) {
      case MSG.CREATE_ROOM:
        this.handleCreateRoom(ws, data);
        break;
      case MSG.JOIN_ROOM:
        this.handleJoinRoom(ws, data);
        break;
      case MSG.RECONNECT:
        this.handleReconnect(ws, data);
        break;
      case MSG.START_GAME:
        this.handleInRoom(ws, room => {
          if (!this.isHost(ws, room)) return;
          const result = room.startGame();
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.SUBMIT_DESCRIPTION:
        this.handleInRoom(ws, room => {
          const result = room.submitDescription(ws._playerId, data.text);
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.SUBMIT_VOTE:
        this.handleInRoom(ws, room => {
          const result = room.submitVote(ws._playerId, data.targetId);
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.NEXT_ROUND:
        this.handleInRoom(ws, room => {
          if (!this.isHost(ws, room)) return;
          const result = room.nextRound();
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.RESTART_GAME:
        this.handleInRoom(ws, room => {
          if (!this.isHost(ws, room)) return;
          const result = room.restartGame();
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.UPDATE_SETTINGS:
        this.handleInRoom(ws, room => {
          if (!this.isHost(ws, room)) return;
          const result = room.updateSettings(data);
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.FORCE_NEXT_PHASE:
        this.handleInRoom(ws, room => {
          if (!this.isHost(ws, room)) return;
          const result = room.forceNextPhase();
          if (result.error) ws.send(pack(MSG.ERROR, { message: result.error }));
        });
        break;
      case MSG.LEAVE_ROOM:
        this.handleLeaveRoom(ws);
        break;
      default:
        ws.send(pack(MSG.ERROR, { message: '未知消息类型' }));
    }
  }

  handleCreateRoom(ws, data) {
    const { playerName, roomCode: customCode } = data;
    if (!playerName || !playerName.trim()) {
      ws.send(pack(MSG.ERROR, { message: '请输入你的名字' }));
      return;
    }

    // 支持自定义房间号
    let roomCode;
    if (customCode && customCode.trim()) {
      roomCode = customCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,6}$/.test(roomCode)) {
        ws.send(pack(MSG.ERROR, { message: '房间号只能包含字母和数字，最多6位' }));
        return;
      }
      if (this.rooms.has(roomCode)) {
        ws.send(pack(MSG.ERROR, { message: '该房间号已被占用' }));
        return;
      }
    } else {
      roomCode = this.generateRoomCode();
    }

    const room = new GameRoom(roomCode, ws, playerName.trim());

    this.rooms.set(roomCode, room);

    ws.send(pack(MSG.ROOM_CREATED, {
      roomCode,
      playerId: ws._playerId,
      players: room.getPlayersInfo(),
      settings: room.settings,
    }));
  }

  handleJoinRoom(ws, data) {
    const { roomCode, playerName } = data;
    if (!playerName || !playerName.trim()) {
      ws.send(pack(MSG.ERROR, { message: '请输入你的名字' }));
      return;
    }
    if (!roomCode) {
      ws.send(pack(MSG.ERROR, { message: '请输入房间代码' }));
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) {
      ws.send(pack(MSG.ERROR, { message: '房间不存在' }));
      return;
    }
    if (room.phase !== 'WAITING') {
      ws.send(pack(MSG.ERROR, { message: '游戏已经开始，无法加入' }));
      return;
    }
    if (room.players.length >= room.settings.maxPlayers) {
      ws.send(pack(MSG.ERROR, { message: '房间已满' }));
      return;
    }

    const name = playerName.trim();
    if (room.players.some(p => p.name === name)) {
      ws.send(pack(MSG.ERROR, { message: '该名字已被使用' }));
      return;
    }

    const player = room.addPlayer(ws, name);

    // 通知加入者
    ws.send(pack(MSG.ROOM_JOINED, {
      roomCode: code,
      playerId: player.id,
      players: room.getPlayersInfo(),
      settings: room.settings,
    }));

    // 通知房间内其他人
    room.broadcast(MSG.PLAYER_JOINED, {
      player: { id: player.id, name: player.name, isHost: false, alive: true },
      players: room.getPlayersInfo(),
    }, player.id);
  }

  handleReconnect(ws, data) {
    const { roomCode, playerId, playerName } = data;
    if (!roomCode || !playerId) {
      ws.send(pack(MSG.ERROR, { message: '重连信息不完整' }));
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) {
      ws.send(pack(MSG.ERROR, { message: '房间已失效，请重新创建' }));
      return;
    }

    const result = room.reconnectPlayer(playerId, ws);
    if (!result) {
      ws.send(pack(MSG.ERROR, { message: '重连失败，请重新加入' }));
      return;
    }

    // 取消房间销毁定时器
    this.cancelRoomDestroy(code);

    // 发送重连成功消息，包含完整的当前状态
    ws.send(pack(MSG.RECONNECTED, {
      roomCode: code,
      playerId: result.player.id,
      players: room.getPlayersInfo(),
      settings: room.settings,
      phase: room.phase,
      round: room.round,
      word: result.player.word,
      isHost: result.player.isHost,
    }));

    // 通知其他人该玩家已重连
    room.broadcast(MSG.PLAYER_JOINED, {
      player: { id: result.player.id, name: result.player.name, isHost: result.player.isHost, alive: result.player.alive },
      players: room.getPlayersInfo(),
      reconnected: true,
    }, result.player.id);
  }

  handleLeaveRoom(ws) {
    if (!ws._roomCode) return;
    const roomCode = ws._roomCode;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.removePlayer(ws._playerId);
    ws._roomCode = null;
    ws._playerId = null;

    // 如果房间没人了，立即销毁
    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      this.cancelRoomDestroy(roomCode);
    }
  }

  handleDisconnect(ws) {
    if (!ws._roomCode) return;
    const roomCode = ws._roomCode;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.markDisconnected(ws._playerId);

    // 检查是否还有连接的玩家
    const connected = room.players.filter(p => p.ws !== null);
    if (connected.length === 0) {
      // 所有人断线，延迟120秒后销毁房间
      this.scheduleRoomDestroy(roomCode, 120000);
    }
  }

  scheduleRoomDestroy(roomCode, delay) {
    // 取消之前的定时器
    this.cancelRoomDestroy(roomCode);

    const timer = setTimeout(() => {
      const room = this.rooms.get(roomCode);
      if (room) {
        const connected = room.players.filter(p => p.ws !== null);
        if (connected.length === 0) {
          this.rooms.delete(roomCode);
          this.roomDestroyTimers.delete(roomCode);
        }
      }
    }, delay);

    this.roomDestroyTimers.set(roomCode, timer);
  }

  cancelRoomDestroy(roomCode) {
    const timer = this.roomDestroyTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.roomDestroyTimers.delete(roomCode);
    }
  }

  handleInRoom(ws, callback) {
    if (!ws._roomCode) {
      ws.send(pack(MSG.ERROR, { message: '你不在任何房间中' }));
      return;
    }
    const room = this.rooms.get(ws._roomCode);
    if (!room) {
      ws.send(pack(MSG.ERROR, { message: '房间不存在' }));
      return;
    }
    callback(room);
  }

  isHost(ws, room) {
    const player = room.players.find(p => p.id === ws._playerId);
    if (!player || !player.isHost) {
      ws.send(pack(MSG.ERROR, { message: '只有房主可以执行此操作' }));
      return false;
    }
    return true;
  }
}

module.exports = RoomManager;
