'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HeartBox,CONFIG}=require('./script.js');
const vm=require('node:vm'),fs=require('node:fs');
function setup(sequence='EEEEHH',round=2){
 const g=new HeartBox(()=>.99);g.state.round=round;g.resetRound();
 const s=g.state;s.phaseData.sequence=[...sequence];s.phaseData.hitCount=[...sequence].filter(x=>x==='H').length;
 s.gm.rights={heal:false,darkness:false,steal:false};s.gm.used={heal:false,darkness:false,steal:false};
 return g;
}
function use(g,type){return g.usePlayerItem(g.state.player.items.indexOf(type));}
function advance(g){g.choosePlayerAction('NONE');g.nextTurn();}
test('3〜7ターンのH数と均等抽選の境界',()=>{
 const g=new HeartBox(()=>.99),lengths=[3,4,5,6,7],expected=[[1],[2],[2,3],[2,3,4],[3,4]];
 g.state.phase=2;
 for(let i=0;i<lengths.length;i++){
   const length=lengths[i],options=expected[i];assert.deepEqual(g.hitCountOptions(length),options);
   for(let j=0;j<options.length;j++){
     for(const roll of [j/options.length,(j+1)/options.length-1e-9]){
       g.random=()=>roll;assert.equal(g.pick(g.hitCountOptions(length)),options[j]);
     }
     // 長さを固定し、実際の配置生成にも設定が反映されることを確認。
     let draws=0;g.pick=values=>draws++===0?length:values[j];g.random=()=>.5;
     const sequence=g.generateSequence();assert.equal(sequence.length,length);
     assert.equal(sequence.filter(x=>x==='H').length,options[j]);
     delete g.pick;
   }
 }
});
test('第1ラウンドの最初だけ3ターン固定、リスタートでも適用',()=>{
 const g=new HeartBox(()=>.99);
 assert.equal(g.phaseLength,3);assert.equal(g.state.phaseData.hitCount,1);
 g.startPhase();assert.equal(g.phaseLength,4);
 g.state.gm.hp=0;g.checkGameOver();g.startNextRound();assert.equal(g.phaseLength,5);assert.equal(g.state.phaseData.hitCount,2);
 g.startPhase();assert.equal(g.phaseLength,8);assert.equal(g.state.phaseData.hitCount,4);
 g.startGame();assert.equal(g.phaseLength,3);assert.equal(g.state.phaseData.hitCount,1);
});
test('ラウンド別HP・長さ・H数、第1ラウンドはアイテムなし',()=>{
 const g=setup('HEHE',1);assert.equal(g.state.player.hp,3);assert.equal(g.state.gm.hp,3);assert.deepEqual(g.state.player.items,[]);assert.equal(use(g,'XRAY'),false);
 for(const round of [1,2]){g.state.round=round;for(let i=0;i<100;i++){const seq=g.generateSequence();assert.ok(g.roundRules.turns.includes(seq.length));assert.ok(g.hitCountOptions(seq.length).includes(seq.filter(x=>x==='H').length));}}
 g.resetRound();assert.equal(g.state.player.hp,3);assert.equal(g.state.gm.hp,4);assert.equal(g.state.player.items.length,4);
});
test('通常ボム2回または強化ボム1回で累計2ダメージ・フェーズ終了',()=>{
 for(const powered of [0,1]){const g=setup('HHEEHH'),s=g.state;s.player.bombMissStreak=powered;
 g.choosePlayerAction('BOMB');assert.equal(s.result.gmDamage,powered?2:1);
 assert.equal(s.phaseData.ended,!!powered);assert.equal(g.choosePlayerAction('BOMB'),false);
 if(!powered){g.nextTurn();assert.equal(s.phase,1);g.choosePlayerAction('BOMB');}
 assert.equal(s.phaseData.damageTaken,2);assert.equal(s.phaseData.ended,true);g.nextTurn();assert.equal(s.phase,2);assert.equal(s.phaseData.damageTaken,0);}
});
test('通常ボム後の強化ボムもフェーズ上限2を超えない',()=>{
 const g=setup('HEHEHH'),s=g.state;g.choosePlayerAction('BOMB');g.nextTurn();g.choosePlayerAction('BOMB');g.nextTurn();g.choosePlayerAction('BOMB');assert.equal(s.result.gmDamage,1);assert.equal(s.phaseData.damageTaken,2);assert.equal(s.gm.hp,2);assert.equal(s.phaseData.ended,true);
});
test('ボム失敗は継続、シールドは強化維持、待機と成功で解除',()=>{
 const g=setup(),s=g.state;g.choosePlayerAction('BOMB');assert.equal(s.player.hp,2);assert.equal(s.phaseData.ended,false);g.nextTurn();g.choosePlayerAction('SHIELD');assert.equal(s.player.bombMissStreak,1);g.nextTurn();g.choosePlayerAction('NONE');assert.equal(s.player.bombMissStreak,0);
 const h=setup();h.choosePlayerAction('BOMB');h.nextTurn();h.choosePlayerAction('BOMB');assert.equal(h.state.result.playerDamage,2);assert.equal(h.state.winner,'LOSE');assert.equal(h.nextTurn(),false);
});
test('全ターン終了でも次フェーズへ進む',()=>{
 const g=setup('EEEEEE');for(let i=0;i<6;i++)advance(g);assert.equal(g.state.phase,2);assert.equal(g.state.stats.turns,6);
});
test('全アイテムCDはフェーズ単位、ターン進行では減らず指定フェーズ後に再使用',()=>{
 for(const [type,cd] of Object.entries(CONFIG.ITEM_CD)){
 const g=setup('EEEEEEEE'),s=g.state;s.player.hp=2;s.player.shieldCooldown=1;
 assert.equal(use(g,type),true);assert.equal(use(g,type),false);assert.equal(s.player.items.length,4);
 const before=g.itemCooldown(type);advance(g);assert.equal(g.itemCooldown(type),before);
 for(let p=1;p<=cd;p++){g.startPhase();assert.equal(g.itemCooldown(type),cd+1-p);assert.equal(use(g,type),false);}
 g.startPhase();s.player.hp=2;s.player.shieldCooldown=1;assert.equal(use(g,type),true);
 }
});
test('早期終了でもアイテムCDは1フェーズ分のみ進む',()=>{
 const g=setup('HEEEHH');use(g,'XRAY');g.state.player.bombMissStreak=1;g.choosePlayerAction('BOMB');g.nextTurn();assert.equal(g.itemCooldown('XRAY'),2);assert.equal(use(g,'XRAY'),false);
});
test('回復は使用フェーズの次から3フェーズ使用不可、P5で再使用',()=>{
 const g=setup(),s=g.state;assert.equal(use(g,'HEAL'),false);s.player.hp=2;assert.equal(use(g,'HEAL'),true);assert.equal(s.player.hp,3);assert.equal(use(g,'HEAL'),false);
 for(let p=2;p<=4;p++){g.startPhase();s.player.hp=2;assert.equal(g.itemCooldown('HEAL'),5-p);assert.equal(use(g,'HEAL'),false);}
 g.startPhase();assert.equal(g.itemCooldown('HEAL'),0);assert.equal(use(g,'HEAL'),true);
});
test('強奪はフェーズ開始にCDなしから1つ均等選択し2ターン封鎖',()=>{
 for(const roll of [0,.26,.51,.99]){const g=setup('EEEEHH'),s=g.state;g.random=()=>roll;s.gm.rights.steal=true;s.phaseData.stealAttempted=false;
 assert.equal(g.trySteal(),true);assert.equal(s.player.items.length,4);assert.equal(s.stealEvaluation.filter(x=>x.selected).length,1);assert.ok(s.stealEvaluation.every(x=>x.probability===.25));
 const type=s.stealEvaluation.find(x=>x.selected).type;assert.equal(g.itemLock(type),2);assert.equal(use(g,type),false);advance(g);assert.equal(g.itemLock(type),1);assert.equal(use(g,type),false);advance(g);assert.equal(g.itemLock(type),0);assert.equal(s.stats.steal,1);}
});
test('強奪はCD中を除外し、対象なしなら不発・途中ターンで再試行しない',()=>{
 const g=setup(),s=g.state;for(const type of s.player.items)s.player.itemTimers[type]={phaseReady:99,blockedUntil:0};
 s.player.itemTimers.SONAR.phaseReady=0;s.gm.rights.steal=true;s.phaseData.stealAttempted=false;
 g.trySteal();assert.equal(s.stealEvaluation[0].type,'SONAR');assert.equal(s.stealEvaluation[0].probability,1);
 const h=setup();for(const type of h.state.player.items)h.state.player.itemTimers[type]={phaseReady:99,blockedUntil:0};
 h.state.gm.rights.steal=true;h.state.phaseData.stealAttempted=false;assert.equal(h.trySteal(),false);assert.equal(h.state.stats.steal,0);
 h.state.player.itemTimers.XRAY.phaseReady=0;advance(h);assert.equal(h.trySteal(),false);assert.equal(h.itemLock('XRAY'),0);
});
test('強奪封鎖は早期フェーズ終了をまたいで残る',()=>{
 const g=setup('HEEEHH'),s=g.state;s.gm.rights.steal=true;s.phaseData.stealAttempted=false;g.trySteal();const type=s.stealEvaluation.find(x=>x.selected).type;
 s.player.bombMissStreak=1;g.choosePlayerAction('BOMB');g.nextTurn();assert.equal(s.phase,2);assert.equal(g.itemLock(type),1);
});
test('暗黒は情報アイテムを2ターン阻止、回復は最大HP4まで',()=>{
 const g=setup(),s=g.state;g.random=()=>0;s.gm.rights.darkness=true;s.gm.rights.heal=true;s.gm.hp=3;g.startTurn();
 assert.equal(s.gm.hp,4);assert.equal(use(g,'XRAY'),false);assert.equal(use(g,'SONAR'),false);advance(g);assert.equal(use(g,'XRAY'),false);advance(g);assert.equal(use(g,'XRAY'),true);
});
test('ソナーは連続2ターンのH有無のみ、最終ターンは1つ',()=>{
 for(const pair of ['HH','HE','EH','EE']){const g=setup('EEE'+pair+'E');g.state.turn=4;g.random=()=>0;use(g,'SONAR');assert.equal(g.state.information.at(-1).text,'T4:T5 '+(pair==='EE'?'なし':'あり'));}
 const g=setup();g.state.turn=6;use(g,'SONAR');assert.equal(g.state.information.at(-1).text,'T6 あり');
});
test('H数は開始5秒のみで操作によって延長しない',()=>{
 let now=0;const g=new HeartBox(()=>.99,()=>now);assert.equal(g.hitCountVisible(),true);now=4999;assert.equal(g.hitCountVisible(),true);now=5000;assert.equal(g.hitCountVisible(),false);g.startPhase();assert.equal(g.hitCountVisible(),true);assert.ok(g.state.logs.every(x=>!x.includes('フェーズ開始：H')));
});
test('シールドCD0〜3とフェーズ境界持ち越し',()=>{
 for(const cd of [0,1,2,3]){const g=setup('EEEEEEEE');g.setShieldCooldown(cd);g.choosePlayerAction('SHIELD');g.nextTurn();for(let n=cd;n>0;n--){assert.equal(g.choosePlayerAction('SHIELD'),false);advance(g);}assert.equal(g.choosePlayerAction('SHIELD'),true);}
 const g=setup();g.state.turn=6;g.choosePlayerAction('SHIELD');g.nextTurn();assert.equal(g.state.player.shieldCooldown,1);
});
test('ラウンド移行でCD・封鎖・強化状態を初期化し、戦績は保持',()=>{
 const g=setup('HEHE',1),s=g.state;s.gm.hp=1;s.player.itemTimers.XRAY.phaseReady=99;s.player.itemTimers.HEAL.phaseReady=99;s.player.itemTimers.SONAR.blockedUntil=99;
 g.choosePlayerAction('BOMB');assert.equal(s.status,'roundEnd');assert.equal(s.winner,null);g.startNextRound();assert.equal(s.player.hp,3);assert.equal(s.gm.hp,4);assert.equal(s.player.items.length,4);assert.equal(g.itemCooldown('XRAY'),0);assert.equal(g.itemCooldown('HEAL'),0);assert.equal(g.itemLock('SONAR'),0);assert.equal(s.stats.turns,1);
 s.gm.hp=1;s.phaseData.sequence[0]='H';g.choosePlayerAction('BOMB');assert.equal(s.winner,'WIN');assert.equal(g.startNextRound(),false);
});
test('第2ラウンドGM HP5設定・再開始保持・回復上限',()=>{
 const g=setup('HEHE',1);assert.equal(g.setRound2GmHp(5),true);
 assert.equal(g.state.gm.hp,3);g.state.gm.hp=0;g.checkGameOver();g.startNextRound();
 assert.equal(g.state.gm.hp,5);assert.equal(g.state.gm.maxHp,5);
 g.state.gm.hp=4;g.state.gm.rights.heal=true;g.state.gm.used.heal=false;g.startTurn();assert.equal(g.state.gm.hp,5);
 g.setRound2GmHp(4);assert.equal(g.state.gm.hp,5);assert.equal(g.state.gm.maxHp,5);
 assert.equal(g.setRound2GmHp(6),false);g.setRound2GmHp(5);g.startGame();assert.equal(g.round2GmHp,5);assert.equal(g.state.gm.hp,3);
});
test('残りH0・残りターンありなら任意でスキップできる',()=>{
 for(const action of ['BOMB','SHIELD','NONE']){
 const g=setup('HEE',1),s=g.state;assert.equal(g.canSkipPhase(),false);
 g.choosePlayerAction(action);assert.equal(g.canSkipPhase(),true);
 const hp=s.player.hp,cooldown=s.player.shieldCooldown;
 assert.equal(g.skipPhase(),true);assert.equal(s.phase,2);assert.equal(s.stats.turns,1);
 assert.equal(s.player.hp,hp);assert.equal(s.player.shieldCooldown,cooldown);
 }
 const g=setup('HEE',1);g.choosePlayerAction('BOMB');g.nextTurn();assert.equal(g.canSkipPhase(),true);assert.equal(g.skipPhase(),true);
});
test('Hが残る・全ターン終了・勝敗確定時はスキップできない',()=>{
 const g=setup('HHEE');g.choosePlayerAction('BOMB');assert.equal(g.skipPhase(),false);
 const h=setup('EEH');h.state.turn=3;h.choosePlayerAction('SHIELD');assert.equal(h.skipPhase(),false);
 const k=setup('HEE');k.state.gm.hp=1;k.choosePlayerAction('BOMB');assert.equal(k.skipPhase(),false);
});
test('画面描画・ラウンド移行・常設アイテムとデバッグ',()=>{
 const elements=new Map(),storage={};
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',replaceChildren(){}});return elements.get(id);},createElement(){return {};},querySelectorAll(){return [];}};
 const context=vm.createContext({document,setTimeout(){return 1;},clearTimeout(){},localStorage:{getItem(k){return storage[k]??null;},setItem(k,v){storage[k]=v;}},Math});
 vm.runInContext(fs.readFileSync(require.resolve('./script.js'),'utf8'),context);
 assert.doesNotMatch(elements.get('game').innerHTML,/ROUND 02|PLAYER ITEMS/);elements.get('debug-toggle').onclick();
 document.getElementById('player-hp').value='3';document.getElementById('gm-hp').value='0';elements.get('set-hp').onclick();assert.match(elements.get('game').innerHTML,/ROUND CLEAR/);
 elements.get('next-round').onclick();assert.match(elements.get('game').innerHTML,/常設4種類/);assert.doesNotMatch(elements.get('debug').innerHTML,/評価点|空きに追加/);
 elements.get('restart').onclick();assert.match(elements.get('game').innerHTML,/基本操作/);
});
