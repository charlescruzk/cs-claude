import { events } from '../core/events.js';
import { TEAMS } from '../game/teams.js';

// The Tab-held scoreboard overlay and the round-result banner. The overlay shows
// each participant's kills/deaths under its team, the two team round scores, and
// the round number; the banner names the winner during the 'end' state. K/D is
// accumulated from 'kill' events; the scores and round number are read off the
// Round instance. The DOM shells live in index.html; this module fills and shows
// them.
export class Scoreboard {
   constructor({ bots, round }) {
     this.round = round;          // score {t,ct}, roundNumber, winner
     this.bots = bots;            // BotManager; its .bots carry the CT names
     this.playerName = 'You';
     this.stats = { [this.playerName]: { kills: 0, deaths: 0 } };
     for (const b of bots.bots) this.stats[b.name] = { kills: 0, deaths: 0 };
     this.cells = {};             // participant name -> its K/D span
     this._bind();
     this._build();
     }

     // Grab the index.html shells, fill the two team columns with one K/D row per
     // participant, and start both hidden.
    _build() {
     this.overlay = document.getElementById('scoreboard');
     this.banner = document.getElementById('result-banner');
     this.roundEl = document.getElementById('sb-round');
     this.scoreTEl = document.getElementById('sb-score-t');
     this.scoreCTEl = document.getElementById('sb-score-ct');
     this._column('team-t', [this.playerName]);
     this._column('team-ct', this.bots.bots.map((b) => b.name));
     this.overlay.style.display = 'none';
     this.banner.style.display = 'none';
       }

       // One K/D row per name in the column; keep the number span to update in place.
    _column(colId, names) {
     const col = document.getElementById(colId);
     col.innerHTML = '';
     for (const name of names) {
       const row = document.createElement('div');
       row.className = 'row';
       const who = document.createElement('span');
       who.className = 'who';
       who.textContent = name;
       const kd = document.createElement('span');
       kd.className = 'kd';
       kd.textContent = '0 / 0';
       row.append(who, kd);
       col.appendChild(row);
       this.cells[name] = kd;
         }
       }

     _bind() {
     events.on('kill', (p) => {
       const killer = p.killer || 'unknown';
       const victim = p.victim || 'unknown';
       this._stat(p.killer === 'player' ? this.playerName : killer).kills += 1;
       this._stat(p.victim === 'player' ? this.playerName : victim).deaths += 1;
          });
     events.on('roundEnd', (p) => this._showBanner(p.winner));
     events.on('roundState', (p) => { if (p.state === 'freeze') this._hideBanner(); });
       }

     _stat(name) {
     if (!this.stats[name]) this.stats[name] = { kills: 0, deaths: 0 };
     return this.stats[name];
       }

       // The overlay shows while Tab is held; refresh its numbers every frame it is up.
    update(dt, input) {
     const show = input.keys.has('Tab');
     this.overlay.style.display = show ? 'flex' : 'none';
     if (show) this._render();
        }

     _render() {
     const s = this.round.score;
     this.roundEl.textContent = `Round ${this.round.roundNumber}`;
     this.scoreTEl.textContent = s.t;
     this.scoreCTEl.textContent = s.ct;
     for (const name of Object.keys(this.cells)) {
       const st = this.stats[name];
       this.cells[name].textContent = `${st.kills} / ${st.deaths}`;
         }
       }

     _showBanner(winner) {
     this.banner.textContent = `${TEAMS[winner] ? TEAMS[winner].name : winner} WIN`;
     this.banner.style.display = 'block';
        }

     _hideBanner() {
     this.banner.style.display = 'none';
        }
}
