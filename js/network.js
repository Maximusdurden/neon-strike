// WebRTC networking via PeerJS — zero-build, CDN-loaded.
// Host-authoritative: the host runs the full simulation and broadcasts
// compressed state snapshots; clients send input/action packets.

// PeerJS is loaded globally via <script> in index.html (window.Peer).

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export class NetworkManager {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'client'
    this.roomCode = null;
    this.connected = false;
    this._messageHandler = null;
    this._openHandler = null;
    this._closeHandler = null;
  }

  // Generate a 4-character room code.
  static generateCode() {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    return code;
  }

  // Host: create a room, wait for a client to connect.
  createRoom(onOpen, onMessage, onClose) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer === 'undefined') {
        reject(new Error('PeerJS not loaded'));
        return;
      }
      this.role = 'host';
      this.roomCode = NetworkManager.generateCode();
      this._openHandler = onOpen;
      this._messageHandler = onMessage;
      this._closeHandler = onClose;

      this.peer = new window.Peer('neonstrike-' + this.roomCode);
      this.peer.on('open', () => {
        // Wait for the client to connect.
        this.peer.on('connection', (conn) => {
          this.conn = conn;
          conn.on('open', () => {
            this.connected = true;
            if (this._openHandler) this._openHandler(this.roomCode);
          });
          conn.on('data', (data) => {
            if (this._messageHandler) this._messageHandler(data);
          });
          conn.on('close', () => {
            this.connected = false;
            if (this._closeHandler) this._closeHandler();
          });
        });
        resolve(this.roomCode);
      });
      this.peer.on('error', (err) => reject(err));
    });
  }

  // Client: join a room by code.
  joinRoom(code, onOpen, onMessage, onClose) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer === 'undefined') {
        reject(new Error('PeerJS not loaded'));
        return;
      }
      this.role = 'client';
      this.roomCode = code.toUpperCase();
      this._openHandler = onOpen;
      this._messageHandler = onMessage;
      this._closeHandler = onClose;

      this.peer = new window.Peer(); // random id
      this.peer.on('open', () => {
        this.conn = this.peer.connect('neonstrike-' + this.roomCode, { reliable: true });
        this.conn.on('open', () => {
          this.connected = true;
          if (this._openHandler) this._openHandler(this.roomCode);
        });
        this.conn.on('data', (data) => {
          if (this._messageHandler) this._messageHandler(data);
        });
        this.conn.on('close', () => {
          this.connected = false;
          if (this._closeHandler) this._closeHandler();
        });
        resolve(this.roomCode);
      });
      this.peer.on('error', (err) => reject(err));
    });
  }

  // Send a message to the connected peer.
  send(type, payload) {
    if (!this.conn || !this.connected) return;
    try {
      this.conn.send({ type, ...payload });
    } catch (e) { /* ignore */ }
  }

  // Register a message handler (replaces any previous).
  onMessage(handler) {
    this._messageHandler = handler;
  }

  // Close the connection and clean up.
  close() {
    if (this.conn) {
      try { this.conn.close(); } catch (e) { /* ignore */ }
      this.conn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) { /* ignore */ }
      this.peer = null;
    }
    this.connected = false;
    this.role = null;
  }
}