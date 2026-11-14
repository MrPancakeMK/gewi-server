// server.mjs – Raum-Server für den Online-Modus mit CPU-Plätzen
// Lokal starten: npm start (Port 8080)
// Auf dem Hosting-Dienst wird der Port über process.env.PORT gesetzt.

import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = 4;
const VALID_SLOTS = [0, 1, 2, 3];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

console.log(`Server läuft auf Port ${PORT}`);

function createRoomCode() {
    let code;

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

// CPU-Plätze besitzen keine WebSocket-Verbindung.
function humanSlots(room) {
    return [...room.players]
        .filter(([, player]) => !player.cpu)
        .map(([playerSlot]) => playerSlot);
}

// Der Mensch mit dem kleinsten Platz ist Host und führt CPU-Züge aus.
function hostOf(room) {
    const humans = humanSlots(room);
    return humans.length > 0 ? Math.min(...humans) : -1;
}

function sendToRoom(room, message, exceptSlot = -1) {
    for (const [playerSlot, player] of room.players) {
        if (!player.cpu && playerSlot !== exceptSlot) {
            sendTo(player.ws, message);
        }
    }
}

function lobbyMessage(room) {
    return {
        type: 'lobby',
        hostSlot: hostOf(room),
        players: [...room.players].map(([playerSlot, player]) => ({
            slot: playerSlot,
            figure: player.figure,
            cpu: player.cpu === true
        }))
    };
}

function getHumanPlayer(room, playerSlot, ws) {
    const player = room?.players.get(playerSlot);
    return player && !player.cpu && player.ws === ws ? player : null;
}

function sendError(ws, message) {
    sendTo(ws, { type: 'error', message });
}

function removeRoomIfEmpty(room) {
    if (humanSlots(room).length === 0) {
        rooms.delete(room.code);
        console.log(`Raum ${room.code} geschlossen (keine menschlichen Spieler mehr).`);
        return true;
    }
    return false;
}

wss.on('connection', ws => {
    let room = null;
    let slot = -1;

    ws.on('message', raw => {
        console.log("Nachricht vom Client:", raw.toString());
        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            sendError(ws, 'Ungültige Nachricht vom Client.');
            return;
        }

        if (!msg || typeof msg.type !== 'string') return;

        switch (msg.type) {
            case 'create': {
                if (room) {
                    sendError(ws, 'Du bist bereits in einem Raum.');
                    break;
                }

                const code = createRoomCode();
                room = {
                    code,
                    started: false,
                    players: new Map()
                };

                slot = 0;
                room.players.set(slot, {
                    ws,
                    figure: 0,
                    cpu: false
                });

                rooms.set(code, room);

                console.log(`Raum ${code} erstellt.`);
                sendTo(ws, { type: 'created', code, slot });
                sendToRoom(room, lobbyMessage(room));
                break;
            }
                        case 'join': {
                if (room) {
                    sendError(ws, 'Du bist bereits in einem Raum.');
                    break;
                }

                const code = String(msg.code ?? '').trim().toUpperCase();
                const target = rooms.get(code);

                if (!target) {
                    sendError(ws, 'Raum nicht gefunden. Stimmt der Code?');
                    break;
                }

                if (target.started) {
                    sendError(ws, 'In diesem Raum läuft bereits ein Spiel.');
                    break;
                }

                if (target.players.size >= MAX_PLAYERS) {
                    sendError(ws, 'Der Raum ist voll.');
                    break;
                }

                const freeSlot = VALID_SLOTS.find(candidate => !target.players.has(candidate));
                if (freeSlot === undefined) {
                    sendError(ws, 'Es ist kein freier Spielerplatz vorhanden.');
                    break;
                }

                room = target;
                slot = freeSlot;

                room.players.set(slot, {
                    ws,
                    figure: 0,
                    cpu: false
                });

                sendTo(ws, { type: 'joined', code, slot });
                sendToRoom(room, lobbyMessage(room));
                break;
            }

            case 'figure': {
                if (!room || room.started) break;

                const player = getHumanPlayer(room, slot, ws);
                const figure = Number(msg.figure);

                if (player && Number.isInteger(figure) && figure >= 0 && figure <= 3) {
                    player.figure = figure;
                    sendToRoom(room, lobbyMessage(room));
                }
                break;
            }

            // Nur der Host darf CPU-Plätze hinzufügen.
            case 'addCpu': {
    console.log('➡️ CPU hinzufügen angefordert');
    console.log('Raum:', room?.code);
    console.log('Eigener Slot:', slot);
    console.log('Host-Slot:', room ? hostOf(room) : 'Kein Raum');
    console.log('Spieler vorher:', room ? [...room.players.entries()] : []);

    if (!room || room.started) {
        console.log('❌ Kein Raum oder Spiel bereits gestartet');
        break;
    }

    if (slot !== hostOf(room) || !getHumanPlayer(room, slot, ws)) {
        console.log('❌ Spieler ist nicht der Host');
        sendError(ws, 'Nur der Host kann CPUs hinzufügen.');
        break;
    }

    if (room.players.size >= MAX_PLAYERS) {
        console.log('❌ Raum ist voll');
        sendError(ws, 'Es können maximal vier Spieler teilnehmen.');
        break;
    }

    const freeSlot = VALID_SLOTS.find(candidate => !room.players.has(candidate));

    if (freeSlot === undefined) {
        console.log('❌ Kein freier Slot');
        break;
    }

    room.players.set(freeSlot, {
        ws: null,
        figure: 0,
        cpu: true
    });

    console.log(`✅ CPU zu Raum ${room.code} hinzugefügt (Platz ${freeSlot + 1})`);

    const lobby = lobbyMessage(room);
    console.log('Neue Lobby:', lobby);

    sendToRoom(room, lobby);
    break;
}

            // Nur der Host darf CPU-Plätze entfernen.
            case 'removeCpu': {
                if (!room || room.started) break;

                if (slot !== hostOf(room) || !getHumanPlayer(room, slot, ws)) {
                    sendError(ws, 'Nur der Host kann CPUs entfernen.');
                    break;
                }

                const cpuSlot = Number(msg.slot);
                const target = room.players.get(cpuSlot);

                if (target?.cpu === true) {
                    room.players.delete(cpuSlot);
                    sendToRoom(room, lobbyMessage(room));
                    console.log(`CPU aus Raum ${room.code} entfernt (Platz ${cpuSlot + 1}).`);
                }
                break;
            }
                        case 'start': {
                if (!room || room.started) break;

                if (slot !== hostOf(room) || !getHumanPlayer(room, slot, ws)) {
                    sendError(ws, 'Nur der Host kann das Spiel starten.');
                    break;
                }

                // Mindestens zwei besetzte Plätze; CPU-Plätze zählen mit.
                if (room.players.size < 2) {
                    sendError(ws, 'Mindestens zwei Spieler werden benötigt. Du kannst auch eine CPU hinzufügen.');
                    break;
                }

                room.started = true;
                sendToRoom(room, {
                    ...lobbyMessage(room),
                    type: 'started'
                });

                console.log(`Spiel in Raum ${room.code} gestartet.`);
                break;
            }

            case 'game': {
                if (!room || !room.started) break;

                // Nur ein tatsächlich verbundener Mensch darf Spielereignisse senden.
                // CPU-Züge werden auf dem Host-Gerät ausgeführt und von dort übertragen.
                if (!getHumanPlayer(room, slot, ws)) break;

                sendToRoom(room, {
                    type: 'game',
                    data: msg.data
                }, slot);
                break;
            }

            default:
                break;
        }
    });

    ws.on('close', () => {
        if (!room || slot < 0) return;

        const leavingRoom = room;
        const leavingSlot = slot;
        const leavingPlayer = leavingRoom.players.get(leavingSlot);

        // Verhindert, dass ein alter Socket einen inzwischen neu belegten Platz entfernt.
        if (leavingPlayer && !leavingPlayer.cpu && leavingPlayer.ws === ws) {
            leavingRoom.players.delete(leavingSlot);
        }

        if (removeRoomIfEmpty(leavingRoom)) return;

        if (leavingRoom.started) {
            sendToRoom(leavingRoom, {
                type: 'playerLeft',
                slot: leavingSlot,
                hostSlot: hostOf(leavingRoom)
            });
        } else {
            sendToRoom(leavingRoom, lobbyMessage(leavingRoom));
        }
    });

    ws.on('error', error => {
        console.error('WebSocket-Verbindungsfehler:', error.message);
    });
});

wss.on('error', error => {
    console.error('WebSocket-Serverfehler:', error);
});