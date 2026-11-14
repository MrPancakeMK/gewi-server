// server.mjs – Raum-Server für den Online-Modus (mit CPU-Plätzen)
// Lokal starten: npm start (Port 8080)
// Auf dem Hosting-Dienst gibt der Dienst den Port über PORT vor.
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

console.log(`Server läuft auf Port ${PORT}`);

function createRoomCode() {
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
    } while (rooms.has(code));
    return code;
}

function sendTo(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Plätze mit Verbindung (Menschen). CPU-Plätze haben keine Verbindung.
function humanSlots(room) {
    return [...room.players]
        .filter(([, player]) => !player.cpu)
        .map(([slot]) => slot);
}

// Der Host ist der Mensch mit dem kleinsten Platz. Er führt auch die CPU-Züge aus.
function hostOf(room) {
    return Math.min(...humanSlots(room));
}

function sendToRoom(room, message, exceptSlot = -1) {
    for (const [slot, player] of room.players) {
        if (slot !== exceptSlot && !player.cpu) {
            sendTo(player.ws, message);
        }
    }
}

function lobbyMessage(room) {
    return {
        type: 'lobby',
        hostSlot: hostOf(room),
        players: [...room.players].map(([slot, player]) => ({
            slot,
            figure: player.figure,
            cpu: player.cpu === true
        }))
    };
}

wss.on('connection', ws => {

    let room = null;
    let slot = -1;

    ws.on('message', raw => {

        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }

        switch (msg.type) {

            case 'create': {
                if (room) break;

                const code = createRoomCode();

                room = { code, started: false, players: new Map() };
                rooms.set(code, room);

                slot = 0;
                room.players.set(slot, { ws, figure: 0, cpu: false });

                console.log(`Raum ${code} erstellt`);

                sendTo(ws, { type: 'created', code, slot });
                sendToRoom(room, lobbyMessage(room));
                break;
            }

            case 'join': {
                if (room) break;

                const code = String(msg.code ?? '').trim().toUpperCase();
                const target = rooms.get(code);

                if (!target) {
                    sendTo(ws, { type: 'error', message: 'Raum nicht gefunden. Stimmt der Code?' });
                    break;
                }

                if (target.started) {
                    sendTo(ws, { type: 'error', message: 'In diesem Raum läuft bereits ein Spiel.' });
                    break;
                }

                if (target.players.size >= MAX_PLAYERS) {
                    sendTo(ws, { type: 'error', message: 'Der Raum ist voll.' });
                    break;
                }

                room = target;
                slot = [0, 1, 2, 3].find(s => !room.players.has(s));
                room.players.set(slot, { ws, figure: 0, cpu: false });

                sendTo(ws, { type: 'joined', code, slot });
                sendToRoom(room, lobbyMessage(room));
                break;
            }

            case 'figure': {
                if (!room || room.started) break;

                const player = room.players.get(slot);
                const figure = Number(msg.figure);

                if (player && !player.cpu && Number.isInteger(figure) && figure >= 0 && figure <= 3) {
                    player.figure = figure;
                    sendToRoom(room, lobbyMessage(room));
                }
                break;
            }

            // Nur der Host kann CPU-Plätze hinzufügen und entfernen
            case 'addCpu': {
                if (!room || room.started || slot !== hostOf(room)) break;

                const free = [0, 1, 2, 3].find(s => !room.players.has(s));

                if (free === undefined) {
                    sendTo(ws, { type: 'error', message: 'Es können maximal vier Spieler teilnehmen.' });
                    break;
                }

                room.players.set(free, { ws: null, figure: 0, cpu: true });
                sendToRoom(room, lobbyMessage(room));
                break;
            }

            case 'removeCpu': {
                if (!room || room.started || slot !== hostOf(room)) break;

                const cpuSlot = Number(msg.slot);
                const target = room.players.get(cpuSlot);

                if (target && target.cpu) {
                    room.players.delete(cpuSlot);
                    sendToRoom(room, lobbyMessage(room));
                }
                break;
            }

            case 'start': {
                if (!room || room.started) break;

                if (slot !== hostOf(room)) {
                    sendTo(ws, { type: 'error', message: 'Nur der Host kann das Spiel starten.' });
                    break;
                }

                if (room.players.size < 2) {
                    sendTo(ws, { type: 'error', message: 'Mindestens zwei Spieler werden benötigt.' });
                    break;
                }

                room.started = true;
                sendToRoom(room, { ...lobbyMessage(room), type: 'started' });
                break;
            }

            case 'game': {
                if (!room || !room.started) break;

                // Spielnachrichten werden unverändert an die anderen Menschen weitergeleitet
                sendToRoom(room, { type: 'game', data: msg.data }, slot);
                break;
            }
        }
    });

    ws.on('close', () => {

        if (!room) return;

        room.players.delete(slot);

        // Ohne Menschen im Raum steuert niemand das Spiel: der Raum wird geschlossen
        if (humanSlots(room).length === 0) {
            rooms.delete(room.code);
            return;
        }

        if (room.started) {
            sendToRoom(room, { type: 'playerLeft', slot, hostSlot: hostOf(room) });
        } else {
            sendToRoom(room, lobbyMessage(room));
        }
    });

    ws.on('error', () => {});
});
