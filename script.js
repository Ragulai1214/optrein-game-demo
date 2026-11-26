'use strict';

// 検証パラメータと乱数を一か所に集約する。
const CONFIG = { ROUNDS:[{playerHp:3,gmHp:3,turns:[3,4],items:false},{playerHp:3,gmHp:4,turns:[5,6,7,8],items:true}], HIT_COUNTS_BY_LENGTH:{3:[1],4:[2],5:[2,3],6:[2,3,4],7:[3,4],8:[4]}, HIT_COUNT_REVEAL_MS:5000, BOMB_DAMAGE:1, POWER_BOMB_DAMAGE:2, PHASE_DAMAGE_LIMIT:2, ITEM_CD:{XRAY:2,SONAR:1,REPAIR:2,HEAL:3}, STEAL_LOCK_TURNS:2, SHIELD_COOLDOWN:1, BOMB_SUCCESS_RESETS:true, GM_RIGHT_CHANCE:{heal:.6,darkness:.8,steal:.3}, GM_ACTIVATION_CHANCE:{darkness:.5} };
const ITEMS={XRAY:{name:'レントゲン',help:'現在ターンのH/Eを確認'},HEAL:{name:'回復アンプル',help:'HPを1回復'},REPAIR:{name:'緊急修復キット',help:'シールドを即時修復'},SONAR:{name:'ソナー',help:'ランダムな連続2ターンにHがあるか確認'}};
const ABILITIES={darkness:'暗黒',heal:'回復',steal:'強奪'};
const ACTIONS={NONE:'待機',SHIELD:'シールド',BOMB:'ボム'};
const STAT_NAMES={turns:'総ターン数',bombs:'ボム使用回数',bombHits:'ボム成功回数',bombMisses:'ボム失敗回数',shields:'シールド使用回数',shieldHits:'シールド成功回数',items:'アイテム使用回数',heal:'GM回復回数',darkness:'GM暗黒回数',steal:'GM強奪回数'};
const freshStats=()=>Object.fromEntries(Object.keys(STAT_NAMES).map(k=>[k,0]));

class HeartBox {
  constructor(random=Math.random,now=Date.now){this.random=random;this.now=now;this.shieldCooldownTurns=CONFIG.SHIELD_COOLDOWN;this.round2GmHp=CONFIG.ROUNDS[1].gmHp;this.startGame();}
  // 設定変更は次回のシールド使用から適用し、進行中の修復は維持する。
  setShieldCooldown(turns){
    if(!Number.isInteger(turns)||turns<0||turns>3)return false;
    if(this.shieldCooldownTurns===turns)return true;
    this.shieldCooldownTurns=turns;
    this.state.modified=true;
    this.log(`シールドのクールタイムを${turns}ターンに変更（次回使用から適用）。`);
    return true;
  }
  setRound2GmHp(hp){
    if(![4,5].includes(hp))return false;
    if(this.round2GmHp===hp)return true;
    this.round2GmHp=hp;this.state.modified=true;
    return true;
  }
  pick(values){return values[Math.floor(this.random()*values.length)];}
  chance(p){return this.random()<p;}
  log(text){this.state.logs.push(`R${this.state.round} / P${this.state.phase} / T${this.state.turn} — ${text}`);}
  get roundRules(){return CONFIG.ROUNDS[this.state.round-1];}
  get phaseLength(){return this.state.phaseData.sequence.length;}
  hitCountOptions(length){return [...CONFIG.HIT_COUNTS_BY_LENGTH[length]];}
  startGame(){
    this.state={round:1,phase:0,totalPhases:0,turn:1,logs:[],stats:freshStats(),modified:this.shieldCooldownTurns!==CONFIG.SHIELD_COOLDOWN||this.round2GmHp!==CONFIG.ROUNDS[1].gmHp};
    this.resetRound();
  }
  // 対戦中の状態をすべて初期化。通算戦績・ログとユーザー設定のみ維持する。
  resetRound(){
    const s=this.state;
    Object.assign(s,{phase:0,turn:1,player:{hp:this.roundRules.playerHp,maxHp:this.roundRules.playerHp,shieldCooldown:0,bombMissStreak:0,items:this.roundRules.items?Object.keys(ITEMS):[],itemTimers:Object.fromEntries(Object.keys(ITEMS).map(k=>[k,{phaseReady:0,blockedUntil:0}]))},gm:{hp:s.round===2?this.round2GmHp:this.roundRules.gmHp,maxHp:s.round===2?this.round2GmHp:this.roundRules.gmHp,rights:{},used:{}},phaseData:{},darknessRemaining:0,status:'items',winner:null,information:[],debugEvents:[],stealEvaluation:[],result:null});
    this.startPhase();
  }
  startNextRound(){
    if(this.state.status!=='roundEnd')return false;
    this.state.round++;this.resetRound();return true;
  }
  generateSequence(){
    // 長さと、その長さに対応するH数候補をそれぞれ均等抽選する。
    // 各ラウンドの導入フェーズを固定し、以降は通常の抽選に戻す。
    const firstPhase=this.state.phase===1;
    const length=firstPhase?(this.state.round===1?3:5):this.pick(this.roundRules.turns);
    const n=firstPhase&&this.state.round===2?2:this.pick(this.hitCountOptions(length));
    const a=Array.from({length},(_,i)=>i<n?'H':'E');
    for(let i=a.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  }
  startPhase(){
    const s=this.state;s.phase++;s.totalPhases++;s.turn=1;s.darknessRemaining=0;s.information=[];
    s.phaseData={damageTaken:0,ended:false,stealAttempted:false,sequence:this.generateSequence(),revealed:[],revealUntil:this.now()+CONFIG.HIT_COUNT_REVEAL_MS};
    s.phaseData.hitCount=s.phaseData.sequence.filter(x=>x==='H').length;
    for(const key of Object.keys(ABILITIES)){s.gm.rights[key]=this.roundRules.items&&this.chance(CONFIG.GM_RIGHT_CHANCE[key]);s.gm.used[key]=false;}
    this.log(`フェーズ開始。${this.roundRules.items?'GM使用権抽選。アイテムCDは持ち越し。':'基本行動のみ。'}`);
    this.startTurn();
  }
  hitCountVisible(){return this.now()<this.state.phaseData.revealUntil;}
  publicView(){const s=this.state;return {hp:s.player.hp,maxHp:s.player.maxHp,gmHp:s.gm.hp,cooldown:s.player.shieldCooldown,items:[...s.player.items],remainingTurns:this.phaseLength+1-s.turn,remainingHits:s.phaseData.hitCount-s.phaseData.revealed.filter(x=>x==='H').length,darknessUsed:s.gm.used.darkness};}
  itemCooldown(type){
    const s=this.state,t=s.player.itemTimers[type];
    return Math.max(0,t.phaseReady-s.phase);
  }
  itemLock(type){return Math.max(0,this.state.player.itemTimers[type].blockedUntil-this.state.stats.turns);}
  // 対象判定はCDと既存の封鎖のみ。満タン・修復不要でも準備済みのアイテムは候補。
  trySteal(){
    const s=this.state;
    if(!this.roundRules.items||s.turn!==1||s.phaseData.stealAttempted)return false;
    s.phaseData.stealAttempted=true;
    if(!s.gm.rights.steal||s.gm.used.steal)return false;
    const candidates=s.player.items.filter(type=>!this.itemCooldown(type)&&!this.itemLock(type));
    s.gm.used.steal=true;
    if(!candidates.length){this.log('GMの強奪は対象なしで不発。');return false;}
    const type=this.pick(candidates);
    s.player.itemTimers[type].blockedUntil=s.stats.turns+CONFIG.STEAL_LOCK_TURNS;
    s.stealEvaluation=candidates.map(k=>({type:k,probability:1/candidates.length,selected:k===type}));
    s.stats.steal++;this.log(`GMが${ITEMS[type].name}を強奪：現在から2ターン使用不能。`);return true;
  }
  startTurn(){const s=this.state;s.status='items';s.result=null;s.debugEvents=[];s.stealEvaluation=[];if(!this.roundRules.items)return;for(const key of ['darkness','heal']){let eligible=s.gm.rights[key]&&!s.gm.used[key];if(key==='darkness')eligible=eligible&&s.player.items.some(x=>x==='XRAY'||x==='SONAR');if(key==='heal')eligible=eligible&&s.gm.hp<s.gm.maxHp;const roll=eligible&&key!=='heal'?this.random():null;const activated=!!eligible&&(key==='heal'||roll<CONFIG.GM_ACTIVATION_CHANCE[key]);s.debugEvents.push({ability:key,eligible:!!eligible,roll,activated});if(!activated)continue;s.gm.used[key]=true;s.stats[key]++;if(key==='darkness'){s.darknessRemaining=2;this.log('GMが暗黒を発動。現在と次ターンの情報取得を妨害。');}if(key==='heal'){s.gm.hp++;this.log('GMがHPを1回復。');}}this.trySteal();}
  itemUnavailable(slot){const s=this.state,type=s.player.items[slot];if(!this.roundRules.items)return 'このラウンドでは使用不可';if(!type)return '空きスロット';if(s.status!=='items')return '行動選択前のみ使用可能';if(this.itemLock(type))return `強奪：残り${this.itemLock(type)}ターン`;if(this.itemCooldown(type))return `CD：残り${Math.min(CONFIG.ITEM_CD[type],this.itemCooldown(type))}フェーズ`;if((type==='XRAY'||type==='SONAR')&&s.darknessRemaining>0)return '暗黒により使用不可';if(type==='HEAL'&&s.player.hp>=s.player.maxHp)return 'HP満タン';if(type==='REPAIR'&&!s.player.shieldCooldown)return '修復不要';return '';}
  usePlayerItem(slot){if(this.itemUnavailable(slot))return false;const s=this.state,type=s.player.items[slot];if(type==='HEAL')s.player.hp=Math.min(s.player.maxHp,s.player.hp+1);if(type==='REPAIR')s.player.shieldCooldown=0;if(type==='XRAY')s.information.push({turn:s.turn,text:`T${s.turn}：${s.phaseData.sequence[s.turn-1]}`});if(type==='SONAR'){
      // 未実行の連続2ターンを均等抽選。個数や個別の配置は公開しない。
      // 残り1ターンの場合は従来どおりその1ターンだけを対象にする。
      const n=s.turn+Math.floor(this.random()*Math.max(1,this.phaseLength-s.turn));
      const targets=n<this.phaseLength?[n,n+1]:[n];
      const hasHit=targets.some(t=>s.phaseData.sequence[t-1]==='H');
      s.information.push({turn:s.turn,targets,text:targets.map(t=>`T${t}`).join(':')+' '+(hasHit?'あり':'なし')});
    }const timer=s.player.itemTimers[type];timer.phaseReady=s.phase+CONFIG.ITEM_CD[type]+1;s.stats.items++;this.log(`${ITEMS[type].name}を使用。${type==='XRAY'||type==='SONAR'?s.information.at(-1).text:''}`);return true;}
  choosePlayerAction(action){const s=this.state;if(s.status!=='items'||!ACTIONS[action]||(action==='SHIELD'&&s.player.shieldCooldown))return false;const outcome=s.phaseData.sequence[s.turn-1];const bombDamage=s.player.bombMissStreak?CONFIG.POWER_BOMB_DAMAGE:CONFIG.BOMB_DAMAGE;let playerDamage=0,gmDamage=0;if(action==='BOMB'){s.stats.bombs++;if(outcome==='H'){gmDamage=Math.min(bombDamage,CONFIG.PHASE_DAMAGE_LIMIT-s.phaseData.damageTaken);s.stats.bombHits++;if(CONFIG.BOMB_SUCCESS_RESETS)s.player.bombMissStreak=0;}else{s.stats.bombMisses++;playerDamage=bombDamage;s.player.bombMissStreak=1;}}else{if(action==='NONE')s.player.bombMissStreak=0;if(action==='NONE'&&outcome==='H')playerDamage=1;if(action==='SHIELD'){s.stats.shields++;if(outcome==='H')s.stats.shieldHits++;}}s.player.hp=Math.max(0,s.player.hp-playerDamage);s.gm.hp=Math.max(0,s.gm.hp-gmDamage);s.player.shieldCooldown=action==='SHIELD'?this.shieldCooldownTurns:Math.max(0,s.player.shieldCooldown-1);s.darknessRemaining=Math.max(0,s.darknessRemaining-1);s.phaseData.revealed.push(outcome);s.stats.turns++;s.phaseData.damageTaken+=gmDamage;s.phaseData.ended=s.phaseData.damageTaken>=CONFIG.PHASE_DAMAGE_LIMIT||s.turn===this.phaseLength;s.result={outcome,action,playerDamage,gmDamage,powered:action==='BOMB'&&bombDamage===CONFIG.POWER_BOMB_DAMAGE};this.log(`${outcome} / ${ACTIONS[action]} / PLAYER −${playerDamage} HP / GM −${gmDamage} HP（残HP ${s.player.hp} / ${s.gm.hp}）`);if(s.phaseData.damageTaken>=CONFIG.PHASE_DAMAGE_LIMIT)this.log('GMへの累計2ダメージによりフェーズ終了。残りターンは実行しません。');s.status='result';this.checkGameOver();return true;}
  checkGameOver(){const s=this.state;if(s.player.hp<=0||s.gm.hp<=0){s.status=s.player.hp>0&&s.round<CONFIG.ROUNDS.length?'roundEnd':'over';s.winner=s.status==='roundEnd'?null:s.player.hp<=0?'LOSE':'WIN';return true;}return false;}
  canSkipPhase(){
    const s=this.state;
    return ['items','result'].includes(s.status)&&!s.phaseData.ended&&
      this.phaseLength-s.phaseData.revealed.length>0&&this.publicView().remainingHits===0;
  }
  skipPhase(){
    if(!this.canSkipPhase())return false;
    // 未実行ターンの行動・GM能力・ターン数カウントは進めない。
    this.log(`残りHが0のため、残り${this.phaseLength-this.state.phaseData.revealed.length}ターンをスキップ。`);
    this.startPhase();return true;
  }
  nextTurn(){const s=this.state;if(s.status!=='result')return false;if(s.phaseData.ended)this.startPhase();else{s.turn++;this.startTurn();}return true;}
}

if(typeof module!=='undefined')module.exports={HeartBox,CONFIG};
if(typeof document!=='undefined'){
const game=new HeartBox();let debug=false,recorded=false,totals={games:0,wins:0,turns:0};try{const saved=JSON.parse(localStorage.getItem('heartbox-items-cd-v1-totals'));if(saved&&['games','wins','turns'].every(k=>Number.isFinite(saved[k])&&saved[k]>=0))totals=saved;}catch{}
let hitCountTimer;
const $=id=>document.getElementById(id);
function record(){const s=game.state;if(s.status!=='over'||recorded)return;recorded=true;if(s.modified)return;totals.games++;totals.wins+=s.winner==='WIN'?1:0;totals.turns+=s.stats.turns;try{localStorage.setItem('heartbox-items-cd-v1-totals',JSON.stringify(totals));}catch{}}
function render(){record();const s=game.state,v=game.publicView(),active=s.status==='items';const remainingTurns=game.phaseLength-s.phaseData.revealed.length;const hp=(label,n,max)=>`<div><small>${label}</small><div class="hp">${'♥'.repeat(n)}<span class="muted">${'♡'.repeat(Math.max(0,max-n))}</span> <b>${n} / ${max}</b></div></div>`;
$('game').innerHTML=`<section><h2>ROUND ${String(s.round).padStart(2,'0')} · 対戦状況 <small>${active?(game.roundRules.items?'アイテム使用・行動選択':'行動選択'):s.status==='over'?'ゲーム終了':'ターン結果'}</small></h2><div class="hp-grid">${hp('PLAYER',s.player.hp,s.player.maxHp)}${hp('Owen（GM）',s.gm.hp,s.gm.maxHp)}</div><div class="metrics">${[['PHASE',s.phase],['TURN',`${s.turn} / ${game.phaseLength}`],['残りH / 総H（開始5秒のみ）',game.hitCountVisible()?`${v.remainingHits} / ${s.phaseData.hitCount}`:'非公開'],['残りターン',remainingTurns]].map(([k,n])=>`<div class="metric"><span>${k}</span><strong ${k.startsWith('残りH')?'id="hit-count"':''}>${n}</strong></div>`).join('')}</div><p class="muted">このフェーズのGM被ダメージ：${s.phaseData.damageTaken} / ${CONFIG.PHASE_DAMAGE_LIMIT}</p><div class="history" aria-label="公開済みのH/E">${s.phaseData.sequence.map((_,i)=>`<span class="${i===s.turn-1?'current':''}">${s.phaseData.revealed[i]||'?'}</span>`).join('')}</div></section>
${game.roundRules.items?`<section><h2>GM RIGHTS <small>フェーズごとの使用権</small></h2><div class="row">${Object.keys(ABILITIES).map(k=>`<span class="badge ${s.gm.used[k]?'used':s.gm.rights[k]?'available':''}">${ABILITIES[k]}：${s.gm.used[k]?'USED':s.gm.rights[k]?'AVAILABLE':'NONE'}</span>`).join('')}</div>${s.darknessRemaining?`<div class="notice warning">暗黒：${active?'現在ターンを含む':'次ターンから'}残り${s.darknessRemaining}ターン${s.turn===game.phaseLength?'（フェーズ終了で解除）':''}</div>`:'<p class="muted">暗黒：なし</p>'}</section>`:''}
<section><h2>ゲーム設定</h2><label for="shield-cooldown">シールドのクールタイム </label><select id="shield-cooldown">${[0,1,2,3].map(n=>`<option value="${n}" ${n===game.shieldCooldownTurns?'selected':''}>${n}ターン${n===0?'（連続使用可）':''}</option>`).join('')}</select><p class="muted">次回のシールド使用から適用。現在の修復残りターンは変わりません。</p><label for="round2-gm-hp">第2ラウンドのGM体力 </label><select id="round2-gm-hp">${[4,5].map(n=>`<option value="${n}" ${n===game.round2GmHp?'selected':''}>${n} HP</option>`).join('')}</select><p class="muted">次の第2ラウンド開始時に適用。進行中ならリスタート後に反映します。</p></section>
<section>${game.roundRules.items?`<h2>PLAYER ITEMS <small>常設4種類・CD終了後に再使用</small></h2><p class="muted">使用したフェーズの次からCDを数えます。CD・強奪の封鎖はフェーズをまたいで持ち越します。</p><div class="slots">${s.player.items.map((type,i)=>`<button class="slot" data-item="${i}" ${game.itemUnavailable(i)?'disabled':''}><small>${CONFIG.ITEM_CD[type]}フェーズCD</small><strong>${type?ITEMS[type].name:'空き'}</strong><small>${type?game.itemUnavailable(i)||ITEMS[type].help:'—'}</small></button>`).join('')}</div>${s.information.length?`<div class="notice">${s.information.map(x=>`<div>${x.text}</div>`).join('')}</div>`:''}`:'<h2>基本操作</h2><p class="muted">待機：Hで1ダメージ。シールド：Hを防御。ボム：Hで攻撃、Eで自爆。<br>自爆すると次のボムは命中・自爆ともに2ダメージ。待機かボム成功で解除、シールドでは維持。</p>'}<p class="muted">シールド：${s.player.shieldCooldown?`修復中（残り${s.player.shieldCooldown}ターン使用不可）`:'使用可能'}<br>ボム：${s.player.bombMissStreak?'強化中':'通常'} · 命中／自爆：${s.player.bombMissStreak?CONFIG.POWER_BOMB_DAMAGE:CONFIG.BOMB_DAMAGE}ダメージ</p><div class="actions">${Object.entries(ACTIONS).map(([k,n])=>`<button data-action="${k}" class="${k==='BOMB'?'bomb':''}" ${!active||(k==='SHIELD'&&s.player.shieldCooldown)?'disabled':''}>${n}<small>${k==='NONE'?'Hで自分に1ダメージ':k==='SHIELD'?(game.shieldCooldownTurns===0?'連続使用可能':`防御後、${game.shieldCooldownTurns}ターン修復`):'Hで攻撃 / Eで自爆'}</small></button>`).join('')}</div></section>
${(s.status==='over'||s.status==='roundEnd')&&!s.result?`<section class="result"><h2>${s.status==='roundEnd'?'ROUND CLEAR':s.winner} — デバッグHP変更による終了</h2><button id="again" class="primary">もう一度プレイ</button></section>`:''}
${s.result?`<section class="result ${s.result.powered&&s.result.gmDamage?'power-hit':''}"><h2>${s.status==='roundEnd'?'ROUND CLEAR':s.status==='over'?s.winner==='WIN'?'WIN — GMを撃破':'LOSE — プレイヤー敗北':`T${s.turn} の結果`}</h2>${s.result.powered&&s.result.gmDamage?'<p class="info">強化ボム命中！</p>':''}${s.phaseData.ended?'<p class="info">フェーズ終了</p>':''}<p>GM：<b>${s.result.outcome}</b> / プレイヤー：${ACTIONS[s.result.action]}<br>ダメージ：PLAYER ${s.result.playerDamage} / GM ${s.result.gmDamage}<br>現在HP：PLAYER ${s.player.hp} / GM ${s.gm.hp}<br>ボム：${s.player.bombMissStreak?'強化中':'通常'} / シールド：${s.player.shieldCooldown?`修復中（残り${s.player.shieldCooldown}ターン）`:'使用可能'}</p>${s.status==='result'?`<button id="next" class="primary">${s.phaseData.ended?'次フェーズへ':'次ターンへ'} →</button>`:s.status==='roundEnd'?'':'<button id="again" class="primary">もう一度プレイ</button>'}</section>`:''}
${game.canSkipPhase()?'<section><p>残りHが0のため、これ以上の攻撃チャンスはありません。</p><button id="skip-phase" class="primary">残りターンをスキップ →</button></section>':''}
${s.status==='roundEnd'?`<section class="result"><h2>Owenが次のラウンドを開始する</h2><p>ROUND 02：プレイヤーHP3、GM HP${game.round2GmHp}。アイテムとGMの特殊能力が解禁されます。戦闘状態はすべて初期化されます。</p><button id="next-round" class="primary">次のラウンドへ →</button></section>`:''}`;
clearTimeout(hitCountTimer);
if(game.hitCountVisible())hitCountTimer=setTimeout(()=>{$('hit-count').textContent='非公開';},Math.max(0,s.phaseData.revealUntil-game.now()));
$('logs').replaceChildren(...s.logs.slice().reverse().map(t=>{const p=document.createElement('p');p.textContent=t;return p;}));
$('statistics').innerHTML=`<h2>STATISTICS <small>${s.status==='over'?'最終戦績':'今回の戦績'}</small></h2><p>経過フェーズ（通算）：${s.totalPhases}${s.modified?' · 設定変更・デバッグ操作あり（累計対象外）':''}</p><table>${Object.entries(STAT_NAMES).map(([k,n])=>`<tr><th>${n}</th><td>${s.stats[k]}</td></tr>`).join('')}</table><p class="muted">累計 ${totals.games}戦 / WIN ${totals.wins} / LOSE ${totals.games-totals.wins}<br>プレイヤー勝率 ${totals.games?(100*totals.wins/totals.games).toFixed(1):'0.0'}% / GM勝率 ${totals.games?(100*(totals.games-totals.wins)/totals.games).toFixed(1):'0.0'}%<br>平均 ${totals.games?(totals.turns/totals.games).toFixed(1):'0.0'}ターン（通常プレイのみ）</p>`;
$('debug-toggle').textContent=`デバッグ：${debug?'ON':'OFF'}`;$('debug').hidden=!debug;if(debug)renderDebug();
$('round2-gm-hp').onchange=()=>{game.setRound2GmHp(Number($('round2-gm-hp').value));render();};
$('shield-cooldown').onchange=()=>{game.setShieldCooldown(Number($('shield-cooldown').value));render();};
document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{game.usePlayerItem(Number(b.dataset.item));render();});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{game.choosePlayerAction(b.dataset.action);render();});if($('skip-phase'))$('skip-phase').onclick=()=>{game.skipPhase();render();};if($('next'))$('next').onclick=()=>{game.nextTurn();render();};if($('again'))$('again').onclick=restart;if($('next-round'))$('next-round').onclick=()=>{game.startNextRound();render();};
}
function restart(){game.startGame();recorded=false;render();}
function renderDebug(){const s=game.state,editable=s.status==='items';$('debug').innerHTML=`<h2>DEBUG / 検証専用</h2><p class="muted">状態の変更は行動選択前のみ。公開済みH/Eは固定し、未来の配置だけを変更できます。操作したゲームは累計から除外します。GM能力はこのターンでは再処理しません。強奪はフェーズ開始時だけ判定します。</p><p>配置：<b>${s.phaseData.sequence.join(' ')}</b> / 次に実行するH/E：${editable?s.phaseData.sequence[s.turn-1]:'未開始'}</p><div class="debug-controls"><label>H/E配置<input id="sequence" value="${s.phaseData.sequence.join('')}" maxlength="${game.phaseLength}" size="8"></label><button id="set-sequence" ${editable?'':'disabled'}>配置適用</button><label>PLAYER HP<input id="player-hp" type="number" min="0" max="${s.player.maxHp}" value="${s.player.hp}"></label><label>GM HP<input id="gm-hp" type="number" min="0" max="${s.gm.maxHp}" value="${s.gm.hp}"></label><button id="set-hp" ${editable?'':'disabled'}>HP適用</button><select id="add-type" aria-label="CD解除対象">${Object.keys(ITEMS).map(k=>`<option value="${k}">${ITEMS[k].name}</option>`).join('')}</select><button id="add-item" ${editable&&game.roundRules.items?'':'disabled'}>CD・封鎖解除</button></div><div class="debug-controls">${Object.keys(ABILITIES).map(k=>`<label>${ABILITIES[k]}<select id="right-${k}">${['NONE','AVAILABLE','USED'].map(n=>`<option ${n===(s.gm.used[k]?'USED':s.gm.rights[k]?'AVAILABLE':'NONE')?'selected':''}>${n}</option>`).join('')}</select></label>`).join('')}<button id="set-rights" ${editable&&game.roundRules.items?'':'disabled'}>使用権適用</button></div><p id="debug-message" role="status"></p><h2>能力判定 / 抽選結果</h2><pre>${JSON.stringify({rights:s.gm.rights,used:s.gm.used,checks:s.debugEvents,itemTimers:s.player.itemTimers,bombMissStreak:s.player.bombMissStreak},null,2)}</pre><h2>直近の強奪抽選</h2>${s.stealEvaluation.length?`<table><tr><th>種類</th><th>確率</th><th>選択</th></tr>${s.stealEvaluation.map(r=>`<tr><td>${ITEMS[r.type].name}</td><td>${(r.probability*100).toFixed(2)}%</td><td>${r.selected?'✓':''}</td></tr>`).join('')}</table>`:'<p class="muted">このターンは強奪なし（フェーズ開始時のみ）</p>'}`;
const changed=()=>{s.modified=true;render();};$('set-sequence').onclick=()=>{const a=$('sequence').value.trim().toUpperCase().split(''),h=a.filter(x=>x==='H').length;if(a.length!==game.phaseLength||a.some(x=>!['H','E'].includes(x))||!game.hitCountOptions(game.phaseLength).includes(h)||s.phaseData.revealed.some((x,i)=>a[i]!==x)){$('debug-message').textContent=`H/Eを${game.phaseLength}文字、Hを${game.hitCountOptions(game.phaseLength).join("または")}個で指定し、公開済み部分は維持してください。`;return;}s.phaseData.sequence=a;s.phaseData.hitCount=h;s.information=[];game.log('デバッグ：未来の配置を変更。取得情報をクリア。');changed();};$('set-hp').onclick=()=>{const p=Number($('player-hp').value),g=Number($('gm-hp').value);if(![p,g].every((n,i)=>Number.isInteger(n)&&n>=0&&n<=(i===0?s.player.maxHp:s.gm.maxHp))){$('debug-message').textContent=`PLAYER HPは0〜${s.player.maxHp}、GM HPは0〜${s.gm.maxHp}の整数で指定してください。`;return;}s.player.hp=p;s.gm.hp=g;game.checkGameOver();changed();};$('add-item').onclick=()=>{if(!game.roundRules.items)return;s.player.itemTimers[$('add-type').value]={phaseReady:0,blockedUntil:0};changed();};$('set-rights').onclick=()=>{if(!game.roundRules.items)return;for(const k of Object.keys(ABILITIES)){const v=$(`right-${k}`).value;s.gm.rights[k]=v!=='NONE';s.gm.used[k]=v==='USED';}changed();};}
$('debug-toggle').onclick=()=>{debug=!debug;render();};$('restart').onclick=restart;render();
}
