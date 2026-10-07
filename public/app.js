// =====================================================================
//  우리 학교 학생자치회 — 화면과 기능
//  (데이터 저장은 api.js 를 통해 서버 /api 로 보내요)
// =====================================================================
const GRADES = [
  {g:4, classes:4},
  {g:5, classes:4},
  {g:6, classes:5},
];
const MONTHS = [3,4,5,6,7,8,9,10,11,12,1,2];
const TABS = [
  {id:"notice",   label:"선생님 안내",   who:"교사"},
  {id:"school",   label:"전교회의 결과", who:"교사"},
  {id:"meeting",  label:"학급회의 결과", who:"학생"},
  {id:"activity", label:"월별 활동",     who:"학생"},
  {id:"suggest",  label:"건의사항",      who:"학생"},
  {id:"pledge",   label:"전교임원 공약", who:"교사"},
];
const COLL = {notice:"notices", school:"schoolMeetings", meeting:"meetings", activity:"activities", suggest:"suggestions", agenda:"agendas", send:"sends"};
const CHALLENGE = {
  year:2026, month:10, key:"2026-10", title:"기지개 체조", goal:2,
  desc:"10월 전교회의 결정: 중간놀이 시간에 주 2번 이상 기지개 체조를 해요.",
  holidays:{5:"개천절 대체휴일", 9:"한글날"},
};
const ROLES = [["president","회장"],["vpBoy","남자 부회장"],["vpGirl","여자 부회장"]];
const ALL_CLASSES = GRADES.flatMap(({g,classes})=>Array.from({length:classes},(_,i)=>`${g}-${i+1}`));
const MEETING_PLAN = [
  {date:"2026-09-30", time:"오후 2시", place:""},
  {date:"2026-10-28", time:"중간놀이 시간", place:"2층 6-1반 옆 회의실", special:"평소와 시간·장소가 달라요"},
  {date:"2026-11-25", time:"오후 2시", place:"6-2반"},
  {date:"2026-12-23", time:"오후 2시", place:"6-2반"},
];
const STATUS = {new:"접수", review:"검토 중", done:"답변 완료"};

const state = {
  db:null, teacher:false, dbReady:false, dbFailed:false,
  data:{notices:[], schoolMeetings:[], meetings:[], activities:[], suggestions:[], agendas:[], sends:[]},
  ctab:"pledge", sFilter:"all", agendaDraft:null,
  pins:{classes:{}, council:{}}, pinsLoaded:false, pinsExists:false, units:new Set(), councilUser:null, lockErr:"",
  backupMeta:null, fileMeta:null, restorePending:null, busy:"", sendFile:null, downloads:null,
  homeComposing:false, route:"home", loginErr:"", exSaving:false, adminConfigured:true,
  exercise:{}, officers:{}, pledges:{}, attendance:{}, dtab:"classes", attDate:null, attSaving:false,
  classId:null, tab:"notice", month:null, composing:false, confirmDel:null, readOnly:false,
};
state.month = new Date().getMonth()+1;

/* ---------- helpers ---------- */
function h(tag, attrs={}, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==="class") el.className=v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k==="text") el.textContent=v;
    else el.setAttribute(k, v===true?"":v);
  }
  for (const kid of kids.flat()){
    if (kid==null || kid===false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const gradeOf = id => Number(id.split("-")[0]);
const fmtDate = ts => { if(!ts) return ""; const d=new Date(ts); return `${d.getMonth()+1}월 ${d.getDate()}일`; };
const fmtYmd = s => { if(!s) return ""; const [y,m,d]=s.split("-"); return `${Number(m)}월 ${Number(d)}일`; };
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2400); }
function forClass(list, id){ return list.filter(d=>d.classId===id); }
function noticesFor(id){ return state.data.notices.filter(d=>d.classId===id || d.classId==="all"); }
function unansweredCount(id){ return forClass(state.data.suggestions,id).filter(s=>s.status!=="done").length; }

/* ---------- routing ---------- */
function readHash(){
  if (location.hash==="#teacher"){ state.route="teacher"; state.classId=null; return; }
  if (location.hash==="#council"){ state.route="council"; state.classId="council"; return; }
  const m = location.hash.match(/^#c([456])-(\d)$/);
  if (m){
    const g=Number(m[1]), c=Number(m[2]);
    const def = GRADES.find(x=>x.g===g);
    if (def && c>=1 && c<=def.classes){ state.classId=`${g}-${c}`; state.route="class"; return; }
  }
  state.classId=null; state.route="home";
}
function go(id){
  state.composing=false; state.homeComposing=false; state.confirmDel=null;
  if (id==="teacher"){ location.hash="teacher"; }
  else if (id==="council"){ location.hash="council"; }
  else if (id){ location.hash = "c"+id; }
  else { history.pushState("", "", location.pathname+location.search); state.classId=null; state.route="home"; render(); }
  window.scrollTo(0,0);
}
addEventListener("hashchange", ()=>{ readHash(); state.composing=false; render(); });

/* ---------- render ---------- */
function render(){
  const app=document.getElementById("app");
  let v;
  if (state.route==="class") v = needsLock(state.classId) ? lockView(state.classId) : classView();
  else if (state.route==="teacher") v = teacherView();
  else if (state.route==="council") v = (!state.teacher && !state.councilUser) ? councilLogin() : councilView();
  else v = homeView();
  app.replaceChildren(v);
}

function roleBadge(){
  if (state.teacher) return h("div",{class:"topbar"},
    h("span",{class:"role teacher"},"선생님 모드"),
    h("button",{class:"linkbtn",onclick:()=>go("teacher")},"교사 화면"),
    h("button",{class:"linkbtn",onclick:logout},"로그아웃"));
  return h("div",{class:"topbar"}, h("span",{class:"role"},"학생 화면"),
    h("button",{class:"linkbtn",onclick:()=>go("teacher")},"교사 로그인"));
}

function homeView(){
  const latestAll = state.data.notices.filter(n=>n.classId==="all")[0];
  return h("div",{},
    h("header",{class:"top"},
      h("div",{},
        h("div",{class:"eyebrow"},"2026학년도 2학기"),
        h("h1",{},"우리 학교 학생자치회"),
        h("p",{class:"muted",style:"margin:6px 0 0"},"우리 반 명패를 눌러 들어가세요. 안내를 확인하고, 회의 결과·활동·건의사항을 남길 수 있어요.")
      ),
      roleBadge()
    ),
    scheduleBlock(true),
    latestAll ? h("div",{class:"notice-strip"},
      h("span",{class:"tag"},"전체 안내"),
      h("p",{}, h("strong",{},latestAll.title), "  ", h("span",{class:"muted"},fmtDate(latestAll.createdAt)))
    ) : null,
    isChallengeMonth() ? h("div",{class:"promise"},
      h("span",{class:"tag"},"10월 우리 학교 약속"),
      h("p",{},"중간놀이 시간에 ", h("strong",{},"주 2번 이상 기지개 체조"), "! 반 페이지 → 월별 활동 → 10월에서 한 날을 체크해요.")
    ) : null,
    statusBanner(),
    h("section",{class:"floor council-floor"},
      h("div",{}, h("h2",{},"전교임원"), h("div",{class:"sub"},"회장 1 · 부회장 2")),
      h("button",{class:"door cdoor","aria-label":"전교임원 화면 들어가기",onclick:()=>go("council")},
        h("div",{class:"cplates"}, SCHOOL_ROLES.map(([k,l])=>h("div",{class:"plate"},
          h("span",{},l), h("b",{}, officerLabel(k))))),
        h("div",{class:"meta"}, h("span",{},"공약 · 회의 안건 · 전교 건의 모아보기 · 활동 기록"), h("span",{},"들어가기 →"))
      )
    ),
    h("div",{class:"hall"},
      GRADES.map(({g,classes})=>
        h("section",{class:`floor g${g}`},
          h("div",{}, h("h2",{},`${g}학년`), h("div",{class:"sub"},`${classes}개 반`)),
          h("div",{class:"doors"},
            Array.from({length:classes},(_,i)=>{
              const id=`${g}-${i+1}`;
              const open=unansweredCount(id);
              const posts=forClass(state.data.meetings,id).length+forClass(state.data.activities,id).length+forClass(state.data.suggestions,id).length;
              return h("button",{class:"door","aria-label":`${g}학년 ${i+1}반 들어가기`,onclick:()=>go(id)},
                h("div",{class:"plate"}, h("b",{},`${g}-${i+1}`), h("span",{},"반")),
                h("div",{class:"meta"},
                  h("span",{}, state.dbReady ? `기록 ${posts}개` : " "),
                  state.teacher && open ? h("span",{class:"new"},`건의 ${open}`) : h("span",{},"")
                )
              );
            })
          )
        )
      )
    ),
    h("section",{class:"school-sec"},
      h("div",{class:"pane-intro"},
        h("div",{}, h("h2",{style:"font-size:26px;color:var(--ink)"},"전교회의 결과"),
          h("p",{},"전교 학생회의에서 정한 내용이에요. 올리면 모든 반 페이지에 함께 전달돼요.")),
        writeAllowed("school") && !state.homeComposing ? h("button",{class:"btn",onclick:()=>{state.homeComposing=true;render();setTimeout(()=>document.getElementById("w_topic")?.focus(),0);}},"전교회의 결과 발송") : null
      ),
      state.homeComposing && writeAllowed("school") ? schoolForm() : null,
      schoolList(3)
    )
  );
}

/* ----- 전교회의 결과 (공통) ----- */
function todayYmd(){ const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; }
function closeCompose(){ state.composing=false; state.homeComposing=false; render(); }
function schoolForm(){
  return h("form",{class:"compose",style:"--gc:var(--ink)",onsubmit:e=>{e.preventDefault();
    const f=e.target;
    save("school",{date:f.w_date.value, topic:f.w_topic.value.trim(), result:f.w_result.value.trim(), relay:f.w_relay.value.trim(), author:f.w_author.value.trim(), classId:"all"}, null, "모든 반에 발송했어요");
  }},
    h("div",{class:"row"},
      h("label",{},"회의 날짜", h("input",{type:"date",id:"w_date",name:"w_date",required:true,value:todayYmd()})),
      h("label",{},"기록한 사람", h("input",{type:"text",id:"w_author",name:"w_author",required:true,maxlength:"30",placeholder:"예: 전교 부회장 정유나"}))
    ),
    h("label",{},"회의 주제(안건)", h("input",{type:"text",id:"w_topic",name:"w_topic",required:true,maxlength:"100",placeholder:"예: 11월 학교 축제 반별 부스 정하기"})),
    h("label",{},"결정한 내용", h("textarea",{id:"w_result",name:"w_result",required:true,placeholder:"전교회의에서 정한 내용을 적어 주세요."})),
    h("label",{},"각 반에 전달할 내용 (선택)", h("textarea",{id:"w_relay",name:"w_relay",style:"min-height:60px",placeholder:"예: 각 반 대표는 금요일까지 부스 주제를 정해 오세요."})),
    h("div",{class:"actions"},
      h("button",{type:"button",class:"btn ghost",onclick:closeCompose},"취소"),
      h("button",{type:"submit",class:"btn"},"모든 반에 발송")
    )
  );
}
function schoolList(max){
  let list=state.data.schoolMeetings.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt-a.createdAt));
  if (max) list=list.slice(0,max);
  if (!list.length) return emptyState("아직 전교회의 결과가 없어요", state.teacher ? "‘전교회의 결과 발송’을 누르면 모든 반에 함께 전달돼요." : "전교회의가 끝나면 결과가 여기에 올라와요.");
  return h("div",{class:"list"}, list.map(m=>h("article",{class:"card"},
    h("div",{class:"head"}, h("h3",{},m.topic), h("span",{class:"pill all"},fmtYmd(m.date)+" 전교회의")),
    h("dl",{},
      h("dt",{},"결정"), h("dd",{},m.result),
      m.relay ? [h("dt",{},"전달"), h("dd",{},m.relay)] : null
    ),
    attendanceBlock(m.date),
    h("div",{class:"head"}, h("span",{class:"info"},`기록: ${m.author||"-"}`), delControls("school",m))
  )));
}
function schoolPane(){
  return h("div",{},
    scheduleBlock(false),
    intro("전교 학생회의 결과예요. 모든 반에 똑같이 전달돼요.", "school", "전교회의 결과 발송"),
    state.composing && writeAllowed("school") ? schoolForm() : null,
    schoolList()
  );
}

function statusBanner(){
  if (state.dbFailed) return h("div",{class:"banner"},"지금은 서버에 연결할 수 없어요. 인터넷 연결을 확인하고 잠시 후 새로고침해 주세요.");
  if (!state.dbReady) return h("div",{class:"banner"},"게시판을 불러오는 중이에요…");
  if (state.readOnly) return h("div",{class:"banner"},"이 화면에서는 글을 쓸 수 없어요. 로그인이 풀렸다면 다시 들어와 주세요.");
  return null;
}

function classView(){
  const id=state.classId, g=gradeOf(id), [,c]=id.split("-");
  const counts={
    notice:noticesFor(id).length,
    school:state.data.schoolMeetings.length,
    meeting:forClass(state.data.meetings,id).length,
    activity:forClass(state.data.activities,id).length,
    suggest:forClass(state.data.suggestions,id).length,
    pledge:SCHOOL_ROLES.reduce((n,[k])=>n+((state.pledges[k]?.items)||[]).length,0),
  };
  return h("div",{class:`g${g}`},
    state.teacher ? h("button",{class:"back",onclick:()=>go("teacher")},"← 교사 화면") : h("button",{class:"back",onclick:()=>go(null)},"← 전체 반 보기"),
    state.teacher ? classSwitcher(id) : null,
    !state.teacher && state.units.has(id) ? h("button",{class:"linkbtn",style:"float:right",onclick:()=>lockUnit(id)},"나가기(잠그기)") : null,
    h("div",{class:"classhead"},
      h("div",{style:"display:flex;align-items:center;gap:14px;flex-wrap:wrap"},
        h("div",{class:"plate"}, h("b",{},id)),
        h("h1",{style:"font-size:26px"},`${g}학년 ${c}반 자치회`)
      ),
      roleBadge()
    ),
    statusBanner(),
    h("div",{class:"tabs",role:"tablist"},
      TABS.map(t=>h("button",{class:"tab",role:"tab","aria-selected":String(state.tab===t.id),
        onclick:()=>{state.tab=t.id;state.composing=false;state.confirmDel=null;render();}},
        t.label, h("span",{class:"count"},counts[t.id]||""), h("span",{class:"who"},t.who)))
    ),
    h("div",{role:"tabpanel"}, paneFor(state.tab))
  );
}

function paneFor(tab){
  if (tab==="notice") return noticePane();
  if (tab==="school") return schoolPane();
  if (tab==="meeting") return meetingPane();
  if (tab==="activity") return activityPane();
  if (tab==="pledge") return pledgePane();
  return suggestPane();
}

function writeAllowed(kind){
  if (!state.db || state.readOnly) return false;
  if (kind==="notice" || kind==="school") return state.teacher;
  return true;
}

function intro(text, kind, btnLabel){
  return h("div",{class:"pane-intro"},
    h("p",{},text),
    writeAllowed(kind) && !state.composing ? h("button",{class:"btn",onclick:()=>{state.composing=true;render();setTimeout(()=>document.querySelector("form.compose input,form.compose textarea")?.focus(),0);}},btnLabel) : null
  );
}

function delControls(kind, d){
  if (!state.teacher) return null;
  const key=kind+":"+d.id;
  if (state.confirmDel===key){
    return h("span",{class:"confirm"},"정말 지울까요?",
      h("button",{class:"btn small danger",onclick:()=>removeDoc(kind,d.id)},"지우기"),
      h("button",{class:"btn small ghost",onclick:()=>{state.confirmDel=null;render();}},"취소"));
  }
  return h("button",{class:"btn small ghost",onclick:()=>{state.confirmDel=key;render();}},"삭제");
}

function emptyState(title, body){ return h("div",{class:"empty"}, h("strong",{},title), body); }

/* ----- 안내 ----- */
function noticePane(){
  const id=state.classId, list=noticesFor(id);
  return h("div",{},
    intro("선생님이 우리 반 또는 전체 학생에게 알리는 내용이에요.", "notice", "안내 쓰기"),
    state.composing && writeAllowed("notice") ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target;
      save("notice",{title:f.n_title.value.trim(), body:f.n_body.value.trim(), classId:f.n_all.checked?"all":id});
    }},
      h("label",{},"제목", h("input",{type:"text",id:"n_title",name:"n_title",required:true,maxlength:"80",placeholder:"예: 10월 학급회의 주제 안내"})),
      h("label",{},"내용", h("textarea",{id:"n_body",name:"n_body",required:true,placeholder:"학생들에게 알릴 내용을 적어 주세요."})),
      h("label",{class:"check"}, h("input",{type:"checkbox",id:"n_all",name:"n_all"}), "모든 반(4~6학년)에 함께 안내하기"),
      formActions()
    ) : null,
    list.length ? h("div",{class:"list"}, list.map(n=>h("article",{class:"card"},
      h("div",{class:"head"}, h("h3",{},n.title), n.classId==="all"?h("span",{class:"pill all"},"전체 안내"):null),
      h("p",{},n.body),
      h("div",{class:"head"}, h("span",{class:"info"},fmtDate(n.createdAt)), delControls("notice",n))
    ))) : emptyState("아직 안내가 없어요", state.teacher ? "‘안내 쓰기’를 눌러 첫 안내를 올려 보세요." : "선생님이 안내를 올리면 여기에 보여요.")
  );
}

/* ----- 학급회의 결과 ----- */
function meetingPane(){
  const id=state.classId, list=forClass(state.data.meetings,id).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const today=new Date(); const ymd=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  return h("div",{},
    intro("학급회의를 마치면 기록 담당이 회의 결과를 남겨 주세요.", "meeting", "회의 결과 쓰기"),
    state.composing && writeAllowed("meeting") ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target;
      save("meeting",{date:f.m_date.value, topic:f.m_topic.value.trim(), result:f.m_result.value.trim(), next:f.m_next.value.trim(), author:f.m_author.value.trim(), classId:id});
    }},
      h("div",{class:"row"},
        h("label",{},"회의 날짜", h("input",{type:"date",id:"m_date",name:"m_date",required:true,value:ymd})),
        h("label",{},"기록한 사람", h("input",{type:"text",id:"m_author",name:"m_author",required:true,maxlength:"20",placeholder:"예: 서기 김하늘"}))
      ),
      h("label",{},"회의 주제(안건)", h("input",{type:"text",id:"m_topic",name:"m_topic",required:true,maxlength:"100",placeholder:"예: 쉬는 시간 교실 정리 방법"})),
      h("label",{},"결정한 내용", h("textarea",{id:"m_result",name:"m_result",required:true,placeholder:"회의에서 정한 내용을 적어 주세요."})),
      h("label",{},"앞으로 할 일 (선택)", h("textarea",{id:"m_next",name:"m_next",style:"min-height:60px",placeholder:"누가, 언제까지 무엇을 할지"})),
      formActions()
    ) : null,
    list.length ? h("div",{class:"list"}, list.map(m=>h("article",{class:"card"},
      h("div",{class:"head"}, h("h3",{},m.topic), h("span",{class:"info"},fmtYmd(m.date)+" 회의")),
      h("dl",{},
        h("dt",{},"결정"), h("dd",{},m.result),
        m.next ? [h("dt",{},"할 일"), h("dd",{},m.next)] : null
      ),
      h("div",{class:"head"}, h("span",{class:"info"},`기록: ${m.author||"-"}`), delControls("meeting",m))
    ))) : emptyState("아직 회의 기록이 없어요", "학급회의를 마치면 ‘회의 결과 쓰기’로 첫 기록을 남겨 주세요.")
  );
}

/* ----- 월별 활동 ----- */
function activityPane(){
  const id=state.classId, all=forClass(state.data.activities,id);
  const list=all.filter(a=>a.month===state.month);
  return h("div",{},
    intro(id==="council" ? "전교임원이 그달에 한 활동을 기록해요." : "우리 반 자치회가 그달에 한 활동을 기록해요.", "activity", "활동 기록하기"),
    h("div",{class:"months",role:"group","aria-label":"월 선택"},
      MONTHS.map(m=>{ const n=all.filter(a=>a.month===m).length;
        return h("button",{class:"mbtn","aria-pressed":String(state.month===m),onclick:()=>{state.month=m;render();}}, `${m}월`, n?h("span",{class:"n"},n):null);
      })
    ),
    state.month===CHALLENGE.month && id!=="council" ? exerciseTable(id) : null,
    state.composing && writeAllowed("activity") ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target; const m=Number(f.a_month.value);
      save("activity",{month:m, title:f.a_title.value.trim(), body:f.a_body.value.trim(), author:f.a_author.value.trim(), classId:id}, ()=>{state.month=m;});
    }},
      h("div",{class:"row"},
        h("label",{},"활동한 달", h("select",{id:"a_month",name:"a_month"}, MONTHS.map(m=>h("option",{value:m,selected:m===state.month},`${m}월`)))),
        h("label",{},"쓴 사람", h("input",{type:"text",id:"a_author",name:"a_author",required:true,maxlength:"20",placeholder:"예: 회장 이도윤"}))
      ),
      h("label",{},"활동 이름", h("input",{type:"text",id:"a_title",name:"a_title",required:true,maxlength:"80",placeholder:"예: 복도 바르게 걷기 캠페인"})),
      h("label",{},"한 일과 느낀 점", h("textarea",{id:"a_body",name:"a_body",required:true,placeholder:"무엇을 했고, 어떤 점이 좋았는지 적어 주세요."})),
      formActions()
    ) : null,
    list.length ? h("div",{class:"list"}, list.map(a=>h("article",{class:"card"},
      h("div",{class:"head"}, h("h3",{},a.title), h("span",{class:"info"},`${a.month}월 활동`)),
      h("p",{},a.body),
      h("div",{class:"head"}, h("span",{class:"info"},`${a.author||"-"} · ${fmtDate(a.createdAt)}`), delControls("activity",a))
    ))) : (state.month===CHALLENGE.month ? emptyState("체조 말고 다른 10월 활동 기록은 아직 없어요", "다른 활동을 했다면 ‘활동 기록하기’로 남겨 주세요.") : emptyState(`${state.month}월 활동 기록이 없어요`, "활동을 마쳤다면 ‘활동 기록하기’로 남겨 주세요."))
  );
}

/* ----- 건의사항 ----- */
function suggestPane(){
  const id=state.classId, list=forClass(state.data.suggestions,id);
  return h("div",{},
    intro("우리 반이나 학교에 바라는 점을 선생님께 전해요. 선생님이 답변을 달아 주세요.", "suggest", "건의하기"),
    state.composing && writeAllowed("suggest") ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target;
      const to=`${f.s_grade.value}-${f.s_class.value}`;
      save("suggest",{category:f.s_cat.value, title:f.s_title.value.trim(), body:f.s_body.value.trim(), author:f.s_author.value.trim()||"익명", status:"new", reply:"", classId:to},
        null,
        `${f.s_grade.value}학년 ${f.s_class.value}반 건의로 올렸어요`);
    }},
      h("div",{class:"row"},
        h("label",{},"학년", h("select",{id:"s_grade",name:"s_grade",required:true,onchange:e=>{
            const sel=document.getElementById("s_class"); const def=GRADES.find(x=>x.g===Number(e.target.value));
            sel.replaceChildren(h("option",{value:""},"반 선택"), ...(def?Array.from({length:def.classes},(_,i)=>h("option",{value:i+1},`${i+1}반`)):[]));
            sel.disabled=!def;
          }},
          h("option",{value:""},"학년 선택"), GRADES.map(x=>h("option",{value:x.g},`${x.g}학년`)))),
        h("label",{},"반", h("select",{id:"s_class",name:"s_class",required:true,disabled:true}, h("option",{value:""},"반 선택"))),
        h("label",{},"분류", h("select",{id:"s_cat",name:"s_cat"}, ["학급","학교 시설","행사·활동","급식","기타"].map(c=>h("option",{},c))))
      ),
      h("div",{class:"row"},
        h("label",{},"이름 (비워 두면 익명)", h("input",{type:"text",id:"s_author",name:"s_author",maxlength:"20",placeholder:"예: 박서준"}))
      ),
      h("label",{},"제목", h("input",{type:"text",id:"s_title",name:"s_title",required:true,maxlength:"80",placeholder:"예: 운동장 공 보관함이 필요해요"})),
      h("label",{},"건의 내용", h("textarea",{id:"s_body",name:"s_body",required:true,placeholder:"무엇이 불편한지, 어떻게 바뀌면 좋을지 적어 주세요."})),
      formActions()
    ) : null,
    list.length ? h("div",{class:"list"}, list.map(s=>{
      const st=s.status||"new";
      return h("article",{class:"card"},
        h("div",{class:"head"}, h("h3",{},s.title), h("span",{class:`pill s-${st}`},STATUS[st])),
        h("span",{class:"info"},`${s.classId.replace("-","학년 ")}반 · ${s.category||"기타"} · ${s.author||"익명"} · ${fmtDate(s.createdAt)}`),
        h("p",{},s.body),
        s.reply ? h("div",{class:"reply"}, h("b",{},"선생님 답변"), s.reply) : null,
        state.teacher ? teacherReply(s) : null
      );
    })) : emptyState("아직 건의사항이 없어요", "바라는 점이 있다면 ‘건의하기’를 눌러 선생님께 전해 주세요.")
  );
}

function teacherReply(s){
  const rid="r_"+s.id, sid="st_"+s.id;
  return h("div",{class:"teacher-tools"},
    h("div",{style:"display:grid;gap:6px;width:100%"},
      h("textarea",{id:rid,style:"min-height:56px",placeholder:"답변을 적어 주세요"}, s.reply||""),
      h("div",{class:"actions",style:"justify-content:space-between"},
        h("select",{id:sid,"aria-label":"처리 상태"}, Object.entries(STATUS).map(([k,v])=>h("option",{value:k,selected:(s.status||"new")===k},v))),
        h("div",{style:"display:flex;gap:6px;flex-wrap:wrap"},
          delControls("suggest",s),
          h("button",{class:"btn small",onclick:()=>{
            const reply=document.getElementById(rid).value.trim();
            let status=document.getElementById(sid).value;
            if (reply && status==="new") status="done";
            updateDoc("suggest", s.id, {reply, status}, "답변을 저장했어요");
          }},"답변 저장")
        )
      )
    )
  );
}

function formActions(){
  return h("div",{class:"actions"},
    h("button",{type:"button",class:"btn ghost",onclick:()=>{state.composing=false;render();}},"취소"),
    h("button",{type:"submit",class:"btn"},"올리기")
  );
}

/* ---------- 교사 로그인 ---------- */
function isTyping(){ const a=document.activeElement; return !!(a && a.closest && a.closest("form, .teacher-tools")); }
function syncTeacher(){ state.teacher = !!API.tokens.teacher; }
function logout(){ API.logout("teacher"); syncTeacher(); state.composing=false; state.homeComposing=false; go(null); toast("로그아웃했어요"); }

function teacherView(){
  if (state.teacher) return dashboard();
  const back = h("button",{class:"back",onclick:()=>go(null),style:"justify-self:start;margin:0"},"← 학생 화면으로");
  const box = (...kids)=>h("div",{class:"login"}, back, h("h1",{},"교사 로그인"), ...kids);
  if (state.dbFailed) return box(h("p",{},"지금은 서버에 연결할 수 없어요. 잠시 후 새로고침해 주세요."));
  if (!state.adminConfigured) return box(h("p",{},"교사 비밀번호가 아직 설정되지 않았어요. Cloudflare Pages 설정의 환경변수에 ADMIN_PASSWORD를 넣고 다시 배포해 주세요."));
  return box(
    h("p",{},"교사 비밀번호를 입력하면 모든 반 관리, 안내·전교회의 발송, 건의 답변을 할 수 있어요."),
    h("form",{style:"display:grid;gap:10px",onsubmit:async e=>{e.preventDefault();
      const btn=e.target.querySelector("button[type=submit]"); btn.disabled=true;
      try{ await API.login("teacher", null, e.target.pin.value); state.loginErr=""; syncTeacher(); await state.db.refresh(); render(); loadBackupMeta(); }
      catch(err){ btn.disabled=false; state.loginErr = err.code==="wrong_password" ? "비밀번호가 맞지 않아요." : (err.message||"로그인하지 못했어요."); render(); setTimeout(()=>document.getElementById("pin")?.focus(),0); }
    }},
      h("label",{},"비밀번호", h("input",{type:"password",id:"pin",name:"pin",autocomplete:"current-password",required:true})),
      h("div",{class:"err"},state.loginErr),
      h("button",{class:"btn",type:"submit"},"로그인")
    ));
}

function exStats(id){
  const days=new Set(state.exercise[id]||[]);
  const weeks=calWeeks();
  let ok=0; weeks.forEach(w=>{ if (w.done(days)>=w.goal) ok++; });
  return {count:days.size, ok, total:weeks.length};
}

function dashboard(){
  const pending = state.data.suggestions.filter(s=>s.status!=="done");
  const lastMeeting = id => { const l=forClass(state.data.meetings,id).map(m=>m.date).filter(Boolean).sort(); return l.length?fmtYmd(l[l.length-1]):"없음"; };
  return h("div",{},
    h("header",{class:"top"},
      h("div",{}, h("div",{class:"eyebrow"},"우리 학교 학생자치회"), h("h1",{},"교사 화면"),
        h("p",{class:"muted",style:"margin:6px 0 0"},"반을 누르면 그 반 페이지로 들어가요. 반 페이지 위쪽에서 다른 반으로 바로 옮길 수 있어요.")),
      h("div",{class:"topbar"},
        h("button",{class:"linkbtn",onclick:()=>go(null)},"학생 첫 화면 보기"),
        h("button",{class:"linkbtn",onclick:()=>go("council")},"전교임원 화면"),
        h("button",{class:"linkbtn",onclick:logout},"로그아웃"))
    ),
    statusBanner(),
    h("div",{class:"tabs",role:"tablist",style:"--gc:var(--ink)"},
      [["classes","반 현황"],["inbox",`받은 자료${state.data.sends.filter(x=>x.status!=="seen").length?" "+state.data.sends.filter(x=>x.status!=="seen").length:""}`],["attend","전교회의 출결"],["org","자치회 관리"],["pledge","전교임원 공약"],["backup","백업·설정"]].map(([k,l])=>
        h("button",{class:"tab",role:"tab","aria-selected":String(state.dtab===k),onclick:()=>{state.dtab=k;state.homeComposing=false;render();}},l))
    ),
    state.dtab==="inbox" ? inboxPage() : state.dtab==="backup" ? backupPage() : state.dtab==="attend" ? attendPage() : state.dtab==="org" ? orgPage() : state.dtab==="pledge" ? pledgePane() : classesPage(pending, lastMeeting)
  );
}

function classesPage(pending, lastMeeting){
  return h("div",{},
    GRADES.map(({g,classes})=>h("section",{class:`dash-sec g${g}`},
      h("h2",{style:"color:var(--gc)"},`${g}학년`),
      h("div",{class:"dash-grid"}, Array.from({length:classes},(_,i)=>{
        const id=`${g}-${i+1}`, open=unansweredCount(id), ex=exStats(id);
        return h("button",{class:"dcard",onclick:()=>go(id),"aria-label":`${g}학년 ${i+1}반 관리`},
          h("div",{class:"plate"}, h("b",{},id), h("span",{},"반")),
          h("dl",{},
            h("dt",{},"회장"), h("dd",{}, state.officers[id]?.president || h("span",{class:"muted"},"미등록")),
            h("dt",{},"답변 기다리는 건의"), h("dd",{class:open?"alert":""},`${open}건`),
            h("dt",{},"10월 기지개 체조"), h("dd",{class:ex.ok===ex.total?"good":""},`${ex.count}회 · ${ex.ok}/${ex.total}주 달성`),
            h("dt",{},"최근 학급회의"), h("dd",{},lastMeeting(id))
          ));
      }))
    )),
    h("section",{class:"dash-sec"},
      h("h2",{},`답변 기다리는 건의 ${pending.length}건`),
      pending.length ? h("div",{class:"qlist"}, pending.slice(0,12).map(s=>h("button",{class:`qitem g${gradeOf(s.classId)}`,onclick:()=>{state.tab="suggest";go(s.classId);}},
        h("span",{class:"c"},s.classId), h("span",{class:"t"},s.title), h("span",{class:"info muted",style:"font-size:12.5px"},fmtDate(s.createdAt))
      ))) : emptyState("모든 건의에 답했어요","새 건의가 오면 여기에 모여요.")
    ),
    h("section",{class:"dash-sec school-sec",style:"margin-top:28px"},
      h("div",{class:"pane-intro"},
        h("div",{}, h("h2",{style:"color:var(--ink)"},"전교회의 결과"), h("p",{},"발송하면 모든 반 페이지에 함께 전달돼요.")),
        writeAllowed("school") && !state.homeComposing ? h("button",{class:"btn",style:"--gc:var(--ink)",onclick:()=>{state.homeComposing=true;render();}},"전교회의 결과 발송") : null
      ),
      state.homeComposing ? schoolForm() : null,
      schoolList(3)
    )
  );
}

function classSwitcher(cur){
  return h("nav",{class:"switcher","aria-label":"다른 반으로 이동"},
    h("span",{class:"lbl"},"반 이동"),
    GRADES.flatMap(({g,classes})=>Array.from({length:classes},(_,i)=>{ const id=`${g}-${i+1}`;
      return h("button",{class:`chip g${g}`,"aria-current":String(id===cur),onclick:()=>go(id)},id); }))
  );
}

/* ---------- 전교회의 출결 ---------- */
const SCHOOL_ROLES = [["president","6학년 전교회장"],["vp6","6학년 전교부회장"],["vp5","5학년 전교부회장"]];
const ATT_UNITS = ["school", ...ALL_CLASSES];
const rolesFor = c => c==="school" ? SCHOOL_ROLES : ROLES;
const unitLabel = c => c==="school" ? "전교임원" : c;
function cleanNames(o){ const n={...(o||{})}; delete n.classId; delete n.updatedAt; return n; }

function attSummary(rec){
  let inn=0, checked=0, total=0;
  ATT_UNITS.forEach(c=>{ const rs=rolesFor(c); total+=rs.length; const r=rec?.records?.[c]; if(!r) return;
    rs.forEach(([k])=>{ if (k in r){ checked++; if (r[k]) inn++; } }); });
  return {inn, checked, total};
}
function markCell(r, k, name){
  const has = r && (k in r);
  return h("td",{}, h("span",{class:"mark"},
    has ? (r[k] ? h("span",{class:"m-in"},"출석") : h("span",{class:"m-out"},"결석")) : h("span",{class:"m-none"},"–"),
    name ? h("span",{class:"nm"},name) : null));
}
function attendanceBlock(date){
  const rec = date ? state.attendance[date] : null;
  if (!rec) return state.teacher ? h("p",{class:"att-sum",style:"margin:0"},"이 날짜의 출결 기록이 없어요. 교사 화면 → 전교회의 출결에서 체크할 수 있어요.") : null;
  const sm=attSummary(rec), mine=state.classId;
  const sr=rec.records?.school, snames=sr?.names||cleanNames(state.officers.school);
  return h("details",{class:"att",open:!!mine||null},
    h("summary",{}, "출석 현황", h("span",{class:"att-sum"},`출석 ${sm.inn}명 / ${sm.total}명`)),
    h("div",{class:"tbl-wrap"}, h("table",{class:"atbl"},
      h("thead",{}, h("tr",{}, h("th",{},"전교임원"), SCHOOL_ROLES.map(([,l])=>h("th",{},l)))),
      h("tbody",{}, h("tr",{class:"mine",style:"--gcs:var(--surface-2)"}, h("td",{}, h("span",{class:"cls"},"전교")), SCHOOL_ROLES.map(([k])=>markCell(sr,k,snames[k]))))
    )),
    h("div",{class:"tbl-wrap"}, h("table",{class:"atbl"},
      h("thead",{}, h("tr",{}, h("th",{},"반"), ROLES.map(([,l])=>h("th",{},l)))),
      h("tbody",{}, ALL_CLASSES.map(c=>{ const r=rec.records?.[c], names=r?.names||cleanNames(state.officers[c]);
        return h("tr",{class:(c===mine?"mine ":"")+`g${gradeOf(c)}`}, h("td",{}, h("span",{class:"cls"},c)),
          ROLES.map(([k])=>markCell(r,k,names[k]))); }))
    ))
  );
}
function attRow(date, rec, c, color){
  const rs=rolesFor(c), r=rec?.records?.[c], off=state.officers[c]||{};
  const all={}; rs.forEach(([k])=>all[k]=true);
  return h("tr",{}, h("td",{}, h("span",{class:"cls",style:`color:${color}`},unitLabel(c))),
    rs.map(([k,l])=>h("td",{}, h("label",{class:"chk"+(r&&(k in r)?"":" none")},
      h("input",{type:"checkbox",checked:!!r?.[k],disabled:state.attSaving,"aria-label":`${unitLabel(c)} ${l} 출석`,onchange:e=>setAtt(date,c,{[k]:e.target.checked})}),
      off[k] || "이름 미등록"))),
    h("td",{}, h("button",{class:"btn small ghost",disabled:state.attSaving,onclick:()=>setAtt(date,c,all)},"모두 출석")));
}
function attendPage(){
  const dates = Object.keys(state.attendance).concat(state.data.schoolMeetings.map(m=>m.date).filter(Boolean));
  const uniq=[...new Set(dates)].sort().reverse().slice(0,8);
  const date = state.attDate || todayYmd();
  const rec = state.attendance[date];
  const sm = attSummary(rec);
  return h("div",{class:"attpage"},
    h("div",{class:"bar"},
      h("div",{style:"display:grid;gap:8px"},
        h("label",{},"전교회의 날짜", h("input",{type:"date",id:"att_date",value:date,onchange:e=>{state.attDate=e.target.value;render();}})),
        uniq.length ? h("div",{class:"dchips"}, uniq.map(d=>h("button",{class:"mbtn","aria-pressed":String(d===date),onclick:()=>{state.attDate=d;render();}},fmtYmd(d)))) : null
      ),
      h("div",{style:"text-align:right"}, h("div",{class:"att-total"},`출석 ${sm.inn} / ${sm.total}`),
        h("div",{class:"att-sum"}, `${sm.checked}칸 체크함 · 체크 안 한 칸은 ‘–’로 보여요`))
    ),
    h("p",{class:"muted",style:"margin:0 0 12px;font-size:13.5px"},"출석한 학생에 체크하세요. 한 줄에서 하나라도 체크하면 그 줄의 체크 안 된 칸은 결석으로 기록돼요. 이 날짜에 올린 전교회의 결과에 출석표가 함께 보여요."),
    h("section",{class:"dash-sec",style:"margin-top:14px"},
      h("h2",{style:"color:var(--ink)"},"전교임원"),
      h("div",{class:"tbl-wrap"}, h("table",{class:"atbl"},
        h("thead",{}, h("tr",{}, h("th",{},""), SCHOOL_ROLES.map(([,l])=>h("th",{},l)), h("th",{},""))),
        h("tbody",{}, attRow(date, rec, "school", "var(--ink)"))
      ))
    ),
    GRADES.map(({g,classes})=>h("section",{class:`dash-sec g${g}`,style:"margin-top:14px"},
      h("h2",{style:"color:var(--gc)"},`${g}학년`),
      h("div",{class:"tbl-wrap"}, h("table",{class:"atbl"},
        h("thead",{}, h("tr",{}, h("th",{},"반"), ROLES.map(([,l])=>h("th",{},l)), h("th",{},""))),
        h("tbody",{}, Array.from({length:classes},(_,i)=>attRow(date, rec, `${g}-${i+1}`, "var(--gc)")))
      ))
    ))
  );
}
async function setAtt(date, c, patch){
  if (!state.db || state.attSaving) return;
  const prev = state.attendance[date]?.records?.[c] || {};
  const row = {}; rolesFor(c).forEach(([k])=>row[k]=!!prev[k]);
  Object.assign(row, patch, {names:cleanNames(state.officers[c])});
  const ref = state.db.collection("schoolAttendance").doc(date);
  state.attSaving=true;
  const exists = !!state.attendance[date];
  state.attendance={...state.attendance, [date]:{date, records:{...(state.attendance[date]?.records||{}), [c]:row}}};
  render();
  try{
    if (exists) await ref.update({records:{[c]:row}, updatedAt:Date.now()});
    else await ref.set({date, records:{[c]:row}, updatedAt:Date.now()});
  }catch(e){ toast("저장하지 못했어요. 다시 체크해 주세요."); }
  finally{ state.attSaving=false; render(); }
}

/* ---------- 자치회 관리 ---------- */
function officerInput(c,k,l){
  const off=state.officers[c]||{};
  return h("input",{type:"text",id:`o_${c}_${k}`,maxlength:"20",value:off[k]||"",placeholder:"이름","aria-label":`${unitLabel(c)} ${l} 이름`,
    onchange:e=>saveOfficer(c,k,e.target.value.trim())});
}
function orgPage(){
  return h("form",{onsubmit:e=>e.preventDefault()},
    h("p",{class:"muted",style:"margin:0 0 12px;font-size:13.5px"},"전교임원과 각 반 회장·부회장 이름을 적으세요. 칸을 벗어나면 바로 저장돼요. 비밀번호 칸에 새 비밀번호를 적으면 그 반(전교임원은 그 사람)이 들어갈 때 쓰는 비밀번호가 바뀌어요. 비밀번호가 없으면 누구나 들어갈 수 있어요."),
    h("section",{class:"dash-sec",style:"margin-top:14px"},
      h("h2",{style:"color:var(--ink)"},"전교임원"),
      h("div",{class:"tbl-wrap"}, h("table",{class:"atbl otbl"},
        h("thead",{}, h("tr",{}, h("th",{},"직책"), h("th",{},"이름"), h("th",{},"반"), h("th",{},"개인 비밀번호"))),
        h("tbody",{}, SCHOOL_ROLES.map(([k,l])=>{ const g = k==="vp5"?5:6, def=GRADES.find(x=>x.g===g), off=state.officers.school||{};
          return h("tr",{}, h("td",{style:"text-align:left;font-weight:500"},l),
            h("td",{}, officerInput("school",k,l)),
            h("td",{}, h("select",{id:`oc_${k}`,"aria-label":`${l} 반`,style:"width:auto",onchange:e=>saveOfficer("school",k+"Class",e.target.value)},
              h("option",{value:""},"반 선택"), Array.from({length:def.classes},(_,i)=>{ const c=`${g}-${i+1}`; return h("option",{value:c,selected:off[k+"Class"]===c},`${c}반`); }))),
            h("td",{}, pinInput("council",k,`${l} 비밀번호`)));
        }))
      ))
    ),
    GRADES.map(({g,classes})=>h("section",{class:`dash-sec g${g}`,style:"margin-top:14px"},
      h("h2",{style:"color:var(--gc)"},`${g}학년`),
      h("div",{class:"tbl-wrap"}, h("table",{class:"atbl otbl"},
        h("thead",{}, h("tr",{}, h("th",{},"반"), ROLES.map(([,l])=>h("th",{},l)), h("th",{},"반 비밀번호"))),
        h("tbody",{}, Array.from({length:classes},(_,i)=>{ const c=`${g}-${i+1}`;
          return h("tr",{}, h("td",{}, h("span",{class:"cls",style:"color:var(--gc)"},c)),
            ROLES.map(([k,l])=>h("td",{}, officerInput(c,k,l))), h("td",{}, pinInput("classes",c,`${c} 반 비밀번호`)));
        }))
      ))
    ))
  );
}
async function saveOfficer(c, k, v){
  if (!state.db) return;
  const body={...(state.officers[c]||{}), classId:c};
  rolesFor(c).forEach(([key])=>{ body[key]=body[key]||""; });
  body[k]=v; body.updatedAt=Date.now();
  state.officers={...state.officers, [c]:body};
  try{ await state.db.collection("officers").doc(c).set(body); toast(`${unitLabel(c)} ${(rolesFor(c).find(r=>r[0]===k)||[,"반"])[1]} 저장했어요`); render(); }
  catch(e){ toast("저장하지 못했어요. 다시 입력해 주세요."); }
}

/* ---------- 전교임원 화면 ---------- */
const CTABS = [
  {id:"pledge", label:"공약"},
  {id:"agenda", label:"전교회의 안건"},
  {id:"allsug", label:"전교 건의 모아보기"},
  {id:"school", label:"전교회의 결과"},
  {id:"activity", label:"활동 기록"},
  {id:"send", label:"선생님께 자료 보내기"},
];
const AG_ST = {proposed:"제안", adopted:"다음 회의 안건", done:"회의에서 다룸", held:"보류"};
function councilView(){
  const off=state.officers.school||{};
  const pending=state.data.suggestions.filter(x=>x.status!=="done").length;
  const counts={
    pledge:SCHOOL_ROLES.reduce((n,[k])=>n+((state.pledges[k]?.items)||[]).length,0),
    agenda:state.data.agendas.filter(a=>a.status==="proposed"||a.status==="adopted").length,
    allsug:pending, school:state.data.schoolMeetings.length,
    activity:forClass(state.data.activities,"council").length,
    send:state.councilUser ? state.data.sends.filter(x=>x.from===state.councilUser).length : state.data.sends.length,
  };
  return h("div",{style:"--gc:var(--ink);--gcs:var(--surface-2)"},
    state.teacher ? h("button",{class:"back",onclick:()=>go("teacher")},"← 교사 화면") : h("button",{class:"back",onclick:()=>go(null)},"← 첫 화면"),
    h("div",{class:"classhead chead"},
      h("div",{style:"display:grid;gap:8px"},
        h("div",{style:"display:flex;align-items:center;gap:14px;flex-wrap:wrap"},
          h("div",{class:"plate"}, h("b",{},"전교")), h("h1",{style:"font-size:26px"},"전교임원 화면")),
        h("div",{class:"names"}, SCHOOL_ROLES.map(([k,l])=>h("span",{},l," ",h("b",{},officerLabel(k))))),
        state.councilUser ? h("div",{class:"whoami"}, h("b",{},officerLabel(state.councilUser)), ` (${roleName(state.councilUser)}) 로그인 중 `,
          h("button",{class:"linkbtn",onclick:councilLogout},"로그아웃")) : null
      ),
      roleBadge()
    ),
    statusBanner(),
    h("div",{class:"tabs",role:"tablist"},
      CTABS.map(t=>h("button",{class:"tab",role:"tab","aria-selected":String(state.ctab===t.id),
        onclick:()=>{state.ctab=t.id;state.composing=false;state.confirmDel=null;state.agendaDraft=null;render();}},
        t.label, h("span",{class:"count"},counts[t.id]||"")))
    ),
    h("div",{role:"tabpanel"},
      state.ctab==="agenda" ? agendaPane() :
      state.ctab==="allsug" ? allSuggestPane() :
      state.ctab==="school" ? schoolPane() :
      state.ctab==="activity" ? activityPane() :
      state.ctab==="send" ? sendPane() : pledgePane())
  );
}

function agendaPane(){
  const d=state.agendaDraft||{};
  const groups=["adopted","proposed","done","held"];
  const list=state.data.agendas;
  return h("div",{},
    intro("다음 전교회의에서 이야기할 안건을 모아요. 반 건의에서 골라 올리거나 직접 제안할 수 있어요.", "agenda", "안건 제안하기"),
    state.composing && writeAllowed("agenda") ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target;
      save("agenda",{title:f.g_title.value.trim(), reason:f.g_reason.value.trim(), proposer:f.g_by.value, source:f.g_src.value.trim(), sugId:d.sugId||"", status:"proposed", classId:"council"},
        ()=>{state.agendaDraft=null;}, "안건을 올렸어요");
    }},
      h("div",{class:"row"},
        h("label",{},"제안한 사람", h("select",{id:"g_by",name:"g_by"},
          SCHOOL_ROLES.filter(([k])=>!state.councilUser||k===state.councilUser).map(([k,l])=>{ const t=`${l} ${officerLabel(k)}`; return h("option",{value:t},t); }))),
        h("label",{},"출처 (선택)", h("input",{type:"text",id:"g_src",name:"g_src",maxlength:"40",value:d.source||"",placeholder:"예: 5-3 건의"}))
      ),
      h("label",{},"안건", h("input",{type:"text",id:"g_title",name:"g_title",required:true,maxlength:"100",value:d.title||"",placeholder:"예: 점심시간 운동장 사용 순서 정하기"})),
      h("label",{},"제안하는 까닭", h("textarea",{id:"g_reason",name:"g_reason",required:true,placeholder:"왜 이 안건을 회의에서 다뤄야 하는지 적어 주세요."}, d.reason||"")),
      h("div",{class:"actions"},
        h("button",{type:"button",class:"btn ghost",onclick:()=>{state.agendaDraft=null;closeCompose();}},"취소"),
        h("button",{type:"submit",class:"btn"},"올리기"))
    ) : null,
    list.length ? groups.map(st=>{ const g=list.filter(a=>(a.status||"proposed")===st); if(!g.length) return null;
      return h("section",{class:"agroup"}, h("h3",{class:"gh"},`${AG_ST[st]} ${g.length}`),
        h("div",{class:"list"}, g.map(a=>h("article",{class:"card"},
          h("div",{class:"head"}, h("h3",{},a.title), h("span",{class:`pill a-${st}`},AG_ST[st])),
          h("p",{},a.reason),
          h("div",{class:"head"},
            h("span",{class:"info"}, [a.proposer, a.source?`출처: ${a.source}`:null, fmtDate(a.createdAt)].filter(Boolean).join(" · ")),
            h("span",{style:"display:flex;gap:6px;align-items:center;flex-wrap:wrap"},
              writeAllowed("agenda") ? h("select",{id:`ag_${a.id}`,"aria-label":"안건 상태",style:"width:auto;padding:3px 6px;font-size:13px",
                onchange:e=>updateDoc("agenda",a.id,{status:e.target.value},"상태를 바꿨어요")},
                Object.entries(AG_ST).map(([v,t])=>h("option",{value:v,selected:(a.status||"proposed")===v},t))) : null,
              delControls("agenda",a))
          )
        ))));
    }) : emptyState("아직 올라온 안건이 없어요","‘안건 제안하기’를 누르거나, 전교 건의 모아보기에서 건의를 안건으로 올려 보세요.")
  );
}

function allSuggestPane(){
  const F=[["all","전체"],["open","답변 전"],["done","답변 완료"]];
  let list=state.data.suggestions;
  if (state.sFilter==="open") list=list.filter(x=>x.status!=="done");
  if (state.sFilter==="done") list=list.filter(x=>x.status==="done");
  const used=new Set(state.data.agendas.map(a=>a.sugId).filter(Boolean));
  return h("div",{},
    h("div",{class:"pane-intro"}, h("p",{},"모든 반에서 올라온 건의사항이에요. 여러 반이 함께 바라는 것은 전교회의 안건으로 올려 보세요.")),
    h("div",{class:"sfilter"}, F.map(([k,l])=>h("button",{class:"mbtn","aria-pressed":String(state.sFilter===k),onclick:()=>{state.sFilter=k;render();}},l))),
    list.length ? h("div",{class:"list"}, list.map(x=>h("article",{class:"card"},
      h("div",{class:"head"},
        h("span",{style:"display:flex;gap:8px;align-items:center;min-width:0"},
          h("span",{class:`plate g${gradeOf(x.classId)}`,style:"padding:1px 8px"}, h("b",{style:"font-size:17px"},x.classId)),
          h("h3",{},x.title)),
        h("span",{class:`pill s-${x.status||"new"}`},STATUS[x.status||"new"])),
      h("span",{class:"info"},`${x.category||"기타"} · ${fmtDate(x.createdAt)}`),
      h("p",{},x.body),
      x.reply ? h("div",{class:"reply"}, h("b",{},"선생님 답변"), x.reply) : null,
      writeAllowed("agenda") ? h("div",{class:"actions",style:"justify-content:flex-start"},
        used.has(x.id) ? h("span",{class:"src"},"✓ 안건으로 올렸어요") :
        h("button",{class:"btn small ghost",onclick:()=>{
          state.agendaDraft={title:x.title, reason:x.body, source:`${x.classId} 건의`, sugId:x.id};
          state.ctab="agenda"; state.composing=true; render(); window.scrollTo(0,0);
        }},"안건으로 올리기")) : null
    ))) : emptyState("해당하는 건의가 없어요","각 반에서 건의가 올라오면 여기에 모여요.")
  );
}

/* ---------- 전교임원 공약 ---------- */
const PLEDGE_ST = {plan:"준비 중", doing:"진행 중", done:"이행 완료"};
function pledgePane(){
  const off=state.officers.school||{};
  return h("div",{},
    h("div",{class:"pane-intro"}, h("p",{},"전교임원 선거 때 약속한 공약과 지금 얼마나 지켜지고 있는지 보여 줘요.")),
    h("div",{class:"pledges"}, SCHOOL_ROLES.map(([k,l])=>{
      const items=(state.pledges[k]?.items)||[];
      const done=items.filter(x=>x.status==="done").length;
      return h("article",{class:"card pcard"},
        h("div",{class:"head"},
          h("div",{}, h("div",{class:"prole"},l), h("h3",{class:"pname"}, off[k] || "이름 미등록")),
          items.length ? h("div",{class:"pprog"}, h("b",{},`${done}/${items.length}`), h("span",{},"이행 완료")) : null
        ),
        items.length ? h("div",{class:"pbar","aria-hidden":"true"}, h("i",{style:`width:${Math.round(done/items.length*100)}%`})) : null,
        items.length ? h("ol",{class:"plist"}, items.map((it,i)=>h("li",{},
          h("span",{class:"ptext"},it.text),
          state.teacher
            ? h("span",{class:"pctl"},
                h("select",{id:`ps_${k}_${i}`,"aria-label":"이행 상태",onchange:e=>updatePledge(k,i,{status:e.target.value})},
                  Object.entries(PLEDGE_ST).map(([v,t])=>h("option",{value:v,selected:it.status===v},t))),
                h("button",{class:"btn small ghost",onclick:()=>removePledge(k,i),"aria-label":"공약 지우기"},"삭제"))
            : h("span",{class:`pill p-${it.status||"plan"}`},PLEDGE_ST[it.status||"plan"])
        ))) : h("p",{class:"muted",style:"margin:0;font-size:14px"},"아직 등록된 공약이 없어요."),
        state.teacher && state.db ? h("form",{class:"padd",onsubmit:e=>{e.preventDefault(); const v=e.target.elements[0].value.trim(); if(v){ addPledge(k,v); e.target.reset(); }}},
          h("input",{type:"text",id:`pa_${k}`,maxlength:"120",placeholder:"공약 추가 (예: 쉬는 시간 운동장 공 대여함 만들기)","aria-label":`${l} 공약 추가`}),
          h("button",{class:"btn small",type:"submit",style:"--gc:var(--ink)"},"추가")) : null
      );
    }))
  );
}
async function writePledges(k, items, msg){
  state.pledges={...state.pledges, [k]:{items}}; render();
  try{ await state.db.collection("pledges").doc(k).set({role:k, items, updatedAt:Date.now()}); if(msg) toast(msg); }
  catch(e){ toast("저장하지 못했어요. 다시 시도해 주세요."); }
}
function addPledge(k, text){ writePledges(k, [...((state.pledges[k]?.items)||[]), {text, status:"plan"}], "공약을 추가했어요"); }
function updatePledge(k, i, patch){ const items=((state.pledges[k]?.items)||[]).map((x,j)=>j===i?{...x,...patch}:x); writePledges(k, items, "상태를 바꿨어요"); }
function removePledge(k, i){ writePledges(k, ((state.pledges[k]?.items)||[]).filter((_,j)=>j!==i), "공약을 지웠어요"); }

/* ---------- 전교회의 일정 ---------- */
const DOW="일월화수목금토";
function planLabel(m){ const [y,mo,d]=m.date.split("-").map(Number); return `${mo}월 ${d}일 (${DOW[new Date(y,mo-1,d).getDay()]})`; }
function scheduleBlock(big){
  const today=todayYmd();
  const next=MEETING_PLAN.find(m=>m.date>=today);
  let dday="";
  if (next){ const [y,mo,d]=next.date.split("-").map(Number); const t=new Date(); t.setHours(0,0,0,0);
    const n=Math.round((new Date(y,mo-1,d)-t)/86400000); dday = n===0 ? "오늘" : `D-${n}`; }
  return h("section",{class:"sched"+(big?"":" compact"),"aria-label":"전교회의 일정"},
    next ? h("div",{class:"next"},
      h("span",{class:"lbl"},"다음 전교회의"),
      h("div",{style:"display:grid;gap:2px;min-width:0"},
        h("div",{class:"when"}, `${planLabel(next)} ${next.time}`),
        h("div",{class:"where"}, next.place ? `📍 ${next.place}` : "장소는 추후 안내"),
      ),
      next.special ? h("span",{class:"warn"},next.special) : null,
      h("span",{class:"dday"},dday)
    ) : h("p",{class:"muted",style:"margin:0"},"올해 예정된 전교회의를 모두 마쳤어요."),
    h("div",{class:"slist"}, MEETING_PLAN.map(m=>{ const past=m.date<today, isNext=m===next;
      return h("div",{class:"sitem"+(past?" past":"")+(isNext?" isnext":"")+(m.special?" special":"")},
        h("span",{class:"st"}, past?"완료":isNext?"다음 회의":"예정"),
        h("b",{},planLabel(m)),
        h("span",{},m.time),
        m.place ? h("span",{class:"sp"},m.place) : null);
    }))
  );
}

/* ---------- 비밀번호 (반 · 전교임원) ---------- */
function loadSession(){
  state.units=new Set(Object.keys(API.tokens.classes||{}));
  state.councilUser=API.tokens.council ? API.tokens.councilRole : null;
}
function needsLock(c){
  if (state.teacher) return false;
  if (!state.pinsLoaded) return !state.dbFailed;
  return !!state.pins.classes?.[c] && !state.units.has(c);
}
function lockUnit(c){ API.logout("class", c); state.units.delete(c); go(null); toast("잠갔어요"); }
function lockView(c){
  const g=gradeOf(c), [,n]=c.split("-");
  if (!state.pinsLoaded) return h("div",{class:"login"}, h("p",{},"확인하는 중이에요…"));
  return h("div",{class:`login g${g}`},
    h("button",{class:"back",onclick:()=>go(null),style:"justify-self:start;margin:0"},"← 첫 화면"),
    h("div",{class:"plate",style:"justify-self:start"}, h("b",{},c), h("span",{},"반")),
    h("h1",{style:"color:var(--gc)"},`${g}학년 ${n}반 들어가기`),
    h("p",{},"우리 반 비밀번호를 입력하세요. 비밀번호는 담임 선생님께 물어보세요."),
    h("form",{style:"display:grid;gap:10px",onsubmit:async e=>{e.preventDefault();
      try{ await API.login("class", c, e.target.upin.value.trim()); }
      catch(err){ state.lockErr = err.code==="wrong_password" ? "비밀번호가 맞지 않아요." : (err.message||"들어가지 못했어요."); render(); setTimeout(()=>document.getElementById("upin")?.focus(),0); return; }
      state.lockErr=""; state.units.add(c); render();
    }},
      h("label",{},"반 비밀번호", h("input",{type:"password",id:"upin",name:"upin",autocomplete:"off",required:true})),
      h("div",{class:"err"},state.lockErr),
      h("button",{class:"btn",type:"submit",style:"--gc:var(--gc)"},"들어가기"))
  );
}
function roleName(k){ return (SCHOOL_ROLES.find(r=>r[0]===k)||[,""])[1]; }
function officerLabel(k){ const o=state.officers.school||{}; const nm=o[k]; if(!nm) return "미등록"; return o[k+"Class"] ? `${nm} (${o[k+"Class"]})` : nm; }
function councilLogout(){ API.logout("council"); state.councilUser=null; go(null); state.db.refresh(); toast("로그아웃했어요"); }
function councilLogin(){
  const pick=state.loginPick;
  const back=h("button",{class:"back",onclick:()=>{state.loginPick=null;go(null);},style:"justify-self:start;margin:0"},"← 첫 화면");
  if (!state.pinsLoaded && !state.dbFailed) return h("div",{class:"login"}, back, h("p",{},"확인하는 중이에요…"));
  const needPin = pick && !!state.pins.council?.[pick];
  return h("div",{class:"login wide"}, back,
    h("h1",{},"전교임원 로그인"),
    h("p",{},"누구인지 고르고 자기 비밀번호를 입력하세요."),
    h("div",{class:"who-grid"}, SCHOOL_ROLES.map(([k,l])=>h("button",{class:"who-card","aria-pressed":String(pick===k),
      onclick:()=>{state.loginPick=k;state.lockErr="";render();setTimeout(()=>document.getElementById("cpin")?.focus(),0);}},
      h("span",{},l), h("b",{},officerLabel(k))))),
    pick ? h("form",{style:"display:grid;gap:10px",onsubmit:async e=>{e.preventDefault();
      try{ await API.login("council", pick, needPin ? e.target.cpin.value.trim() : ""); }
      catch(err){ state.lockErr = err.code==="wrong_password" ? "비밀번호가 맞지 않아요." : (err.message||"로그인하지 못했어요."); render(); setTimeout(()=>document.getElementById("cpin")?.focus(),0); return; }
      state.lockErr=""; state.councilUser=pick; state.loginPick=null; render(); state.db.refresh();
      toast(`${officerLabel(pick)} 님, 반가워요`);
    }},
      needPin ? h("label",{},`${roleName(pick)} 비밀번호`, h("input",{type:"password",id:"cpin",name:"cpin",autocomplete:"off",required:true}))
              : h("p",{class:"muted",style:"margin:0;font-size:13.5px"},"아직 비밀번호가 정해지지 않았어요. 선생님께 비밀번호를 정해 달라고 하세요."),
      h("div",{class:"err"},state.lockErr),
      h("button",{class:"btn",type:"submit",style:"--gc:var(--ink)"},"로그인")) : null
  );
}
function pinInput(kind, key, label){
  const on=!!state.pins[kind]?.[key];
  return h("div",{class:"pinset"},
    h("input",{type:"text",id:`pin_${kind}_${key}`,maxlength:"12",autocomplete:"off",placeholder:on?"새 비밀번호":"정하기","aria-label":label,
      onchange:async e=>{ const v=e.target.value.trim(); if(!v) return; await savePin(kind,key,v); e.target.value=""; }}),
    h("span",{class:"st "+(on?"on":"off")}, on?"설정됨":"없음"),
    on ? h("button",{class:"btn small ghost",type:"button",onclick:()=>savePin(kind,key,"")},"해제") : null);
}
async function savePin(kind, key, password){
  try{
    await API.req("PUT","/pins",{kind, key, password});
    const next={classes:{...state.pins.classes}, council:{...state.pins.council}};
    if (password) next[kind][key]=true; else delete next[kind][key];
    state.pins=next; render();
    toast(password?"비밀번호를 정했어요":"비밀번호를 해제했어요");
  }catch(e){ toast(e.message||"저장하지 못했어요. 다시 시도해 주세요."); }
}

/* ---------- 선생님께 자료 보내기 ---------- */
const MAX_ATTACH = 8*1024*1024;      // 첨부파일 최대 8MB
const MAX_IMAGE = 1200*1024;         // 사진은 1.2MB 안으로 줄여서 보내요
const OK_EXT = ["png","jpg","jpeg","gif","webp","pdf","txt","hwp","hwpx","doc","docx","ppt","pptx","xls","xlsx","csv","zip"];
function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }
async function shrinkImage(f){
  const url=await fileToDataURL(f);
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
  for (const [max,q] of [[2000,.82],[1600,.78],[1280,.72],[1024,.66],[800,.6]]){
    const sc=Math.min(1, max/Math.max(img.width,img.height));
    const c=document.createElement("canvas"); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    const out=c.toDataURL("image/jpeg",q);
    if (out.length*0.75<=MAX_IMAGE) return {name:f.name.replace(/\.[^.]+$/,"")+".jpg", type:"image/jpeg", data:out};
  }
  throw new Error("too_big");
}
async function pickAttach(f){
  if (!f){ state.sendFile=null; return render(); }
  const ext=(f.name.split(".").pop()||"").toLowerCase();
  try{
    if (f.type.startsWith("image/") && ext!=="gif") state.sendFile=await shrinkImage(f);
    else {
      if (!OK_EXT.includes(ext)){ toast("이 종류의 파일은 보낼 수 없어요 (사진, pdf, 한글, 워드, 엑셀, 파워포인트, zip)"); return; }
      if (f.size>MAX_ATTACH){ toast("파일이 너무 커요. 8MB보다 작은 파일만 보낼 수 있어요."); return; }
      const data=await fileToDataURL(f);
      state.sendFile={name:f.name, type:f.type||"application/octet-stream", data};
    }
    render();
  }catch{ toast("파일을 읽지 못했어요. 더 작은 파일로 다시 골라 주세요."); }
}
const attachUrls = {};
function attachView(a, owner){
  if (!a) return null;
  const kb=Math.max(1, Math.round((a.size || (a.data ? a.data.length*0.75 : 0))/1024));
  const isImg=(a.type||"").startsWith("image/");
  let src=a.data||null;
  if (!src && isImg && a.id){
    if (attachUrls[a.id]) src=attachUrls[a.id];
    else if (attachUrls[a.id]!==false && (state.teacher || owner)){
      attachUrls[a.id]=false;
      API.blobUrl(`/attach/${a.id}`).then(u=>{ attachUrls[a.id]=u; render(); }).catch(()=>{});
    }
  }
  return h("div",{class:"attach"},
    src && isImg ? h("img",{src,alt:a.name}) : null,
    h("span",{}, `📎 ${a.name} · ${kb>=1024?(kb/1024).toFixed(1)+"MB":kb+"KB"}`),
    a.id && (state.teacher || owner) ? h("button",{class:"btn small ghost",type:"button",onclick:()=>saveAttach(a)},"파일로 저장") : null);
}
async function saveAttach(a){
  try{ await API.download(`/attach/${a.id}`, a.name); }
  catch(e){ toast("저장하지 못했어요. 다시 시도해 주세요."); }
}
function sendPane(){
  const me=state.councilUser;
  const list = me ? state.data.sends.filter(x=>x.from===me) : state.data.sends;
  return h("div",{},
    h("div",{class:"pane-intro"}, h("p",{}, state.teacher ? "전교임원이 보낸 자료는 교사 화면 ‘받은 자료’에서 확인하고 답장할 수 있어요." : "회의 자료, 사진, 계획서 같은 것을 선생님께 바로 보내요. 보낸 자료는 아래에서 확인할 수 있어요.")),
    me && state.db ? h("form",{class:"compose",onsubmit:e=>{e.preventDefault();
      const f=e.target; const o=state.officers.school||{};
      save("send",{from:me, fromRole:roleName(me), fromName:o[me]||"", fromClass:o[me+"Class"]||"", title:f.d_title.value.trim(), body:f.d_body.value.trim(),
        link:f.d_link.value.trim(), attach:state.sendFile||null, status:"new", reply:"", classId:"council"}, ()=>{state.sendFile=null;}, "선생님께 보냈어요");
    }},
      h("div",{class:"info"}, `보내는 사람: ${roleName(me)} ${officerLabel(me)}`),
      h("label",{},"제목", h("input",{type:"text",id:"d_title",name:"d_title",required:true,maxlength:"80",placeholder:"예: 10월 전교회의 안건 정리"})),
      h("label",{},"내용", h("textarea",{id:"d_body",name:"d_body",required:true,placeholder:"선생님께 전할 내용을 적어 주세요."})),
      h("label",{},"링크 (선택)", h("input",{type:"text",id:"d_link",name:"d_link",maxlength:"300",placeholder:"예: 구글 드라이브나 패들렛 주소"})),
      h("label",{},"파일 첨부 (선택 · 8MB까지 · 사진은 자동으로 줄여서 보내요)", h("input",{type:"file",id:"d_file",accept:"image/*,.pdf,.txt,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.zip",onchange:e=>pickAttach(e.target.files[0])})),
      state.sendFile ? h("div",{class:"bkrow"}, attachView(state.sendFile), h("button",{class:"btn small ghost",type:"button",onclick:()=>{state.sendFile=null;render();}},"첨부 빼기")) : null,
      h("div",{class:"actions"}, h("button",{type:"submit",class:"btn"},"선생님께 보내기"))
    ) : null,
    list.length ? h("div",{class:"list"}, list.map(x=>sendCard(x))) : emptyState("보낸 자료가 없어요", me ? "위 칸을 채우고 ‘선생님께 보내기’를 눌러 보세요." : "전교임원이 자료를 보내면 여기에 보여요.")
  );
}
function sendCard(x){
  const st=x.status==="seen"?"seen":"new";
  return h("article",{class:"card"},
    h("div",{class:"head"}, h("h3",{},x.title), h("span",{class:`pill n-${st}`}, st==="seen"?"선생님 확인함":"확인 전")),
    h("span",{class:"info"}, `${x.fromRole||""} ${x.fromName||""}${x.fromClass?` (${x.fromClass})`:""} · ${fmtDate(x.createdAt)}`),
    h("p",{},x.body),
    x.link ? h("p",{style:"font-size:14px"}, "🔗 ", /^https?:\/\//.test(x.link) ? h("a",{href:x.link,target:"_blank",rel:"noopener"},x.link) : x.link) : null,
    attachView(x.attach, x.from===state.councilUser),
    x.reply ? h("div",{class:"reply"}, h("b",{},"선생님 답장"), x.reply) : null,
    state.teacher ? h("div",{class:"teacher-tools"},
      h("div",{style:"display:grid;gap:6px;width:100%"},
        h("textarea",{id:"sr_"+x.id,style:"min-height:52px",placeholder:"답장을 적어 주세요 (선택)"}, x.reply||""),
        h("div",{class:"actions",style:"justify-content:space-between"},
          delControls("send",x),
          h("button",{class:"btn small",onclick:()=>updateDoc("send",x.id,{reply:document.getElementById("sr_"+x.id).value.trim(), status:"seen"},"확인하고 저장했어요")}, "확인 · 답장 저장"))
      )) : null
  );
}
function inboxPage(){
  const list=state.data.sends;
  const unseen=list.filter(x=>x.status!=="seen");
  return h("div",{},
    h("div",{class:"pane-intro"}, h("p",{},`전교임원이 보낸 자료예요. 확인 전 ${unseen.length}건.`),
      h("button",{class:"btn ghost",style:"--gc:var(--ink)",onclick:()=>go("council")},"전교임원 화면 보기")),
    list.length ? h("div",{class:"list"}, [...unseen, ...list.filter(x=>x.status==="seen")].map(sendCard)) : emptyState("받은 자료가 없어요","전교임원이 ‘선생님께 자료 보내기’로 보내면 여기에 모여요.")
  );
}

/* ---------- 백업 · 설정 ---------- */
const fmtFull = ts => { if(!ts) return "없음"; const d=new Date(ts); return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
function countDocs(data){ return Object.values(data||{}).reduce((n,a)=>n+(Array.isArray(a)?a.length:Object.keys(a||{}).length),0); }
async function loadBackupMeta(){
  if (!state.teacher) return;
  try{ const m=await API.req("GET","/backup/meta"); state.backupMeta=m.server||null; state.fileMeta=m.file||null; render(); }catch{}
}
async function serverSave(){
  if (state.busy) return;
  state.busy="서버에 저장하는 중이에요…"; render();
  try{ const m=await API.req("POST","/backup/save"); state.backupMeta=m.server||null; state.fileMeta=m.file||state.fileMeta; toast("서버에 저장했어요"); }
  catch(e){ toast(e.message||"서버 저장에 실패했어요. 다시 시도해 주세요."); }
  finally{ state.busy=""; render(); }
}
function prepareServerRestore(){
  if (!state.backupMeta?.savedAt){ toast("서버에 저장된 백업이 없어요."); return; }
  state.restorePending={source:"서버 백업", savedAt:state.backupMeta.savedAt, count:state.backupMeta.docCount||0, from:"server"};
  render();
}
async function fileSave(){
  if (state.busy) return;
  state.busy="파일을 만드는 중이에요…"; render();
  try{
    const j=await API.req("GET","/backup/file");
    API.saveBlob(new Blob([JSON.stringify(j)],{type:"application/json"}), `학생자치회_백업_${todayYmd()}.json`);
    state.fileMeta={savedAt:j.savedAt, docCount:countDocs(j.collections)};
    toast("파일로 저장했어요");
  }catch(e){ toast(e.message||"파일 저장에 실패했어요."); }
  finally{ state.busy=""; render(); }
}
async function fileRestorePick(f){
  if (!f) return;
  try{
    const j=JSON.parse(await f.text());
    if (j.app!=="student-council" || !j.collections) throw new Error("bad");
    state.restorePending={source:`파일 (${f.name})`, savedAt:j.savedAt, count:countDocs(j.collections), data:j}; render();
  }catch{ toast("학생자치회 백업 파일이 아니에요. 다른 파일을 골라 주세요."); }
}
async function doRestore(){
  const p=state.restorePending; if (!p || state.busy) return;
  state.restorePending=null;
  state.busy="되돌리는 중이에요…"; render();
  try{
    await API.req("POST","/backup/restore", p.from==="server" ? {from:"server"} : {data:p.data});
    await state.db.refresh();
    toast("되돌렸어요");
  }catch(e){ toast(e.message||"되돌리지 못했어요. 다시 시도해 주세요."); }
  finally{ state.busy=""; render(); }
}
function backupPage(){
  const bm=state.backupMeta, fm=state.fileMeta, p=state.restorePending, busy=!!state.busy;
  return h("div",{class:"bk"},
    state.busy ? h("div",{class:"busy"},state.busy) : null,
    p ? h("div",{class:"warnbox",role:"alert"},
      h("p",{}, h("strong",{},`${p.source} · ${fmtFull(p.savedAt)} 저장본`), `으로 되돌릴까요? 글 ${p.count}개가 그때 상태로 바뀌고, 그 뒤에 쓴 글은 사라져요. 비밀번호와 백업 기록은 그대로예요.`),
      h("div",{class:"bkrow"},
        h("button",{class:"btn",style:"--gc:var(--danger)",onclick:doRestore},"되돌리기"),
        h("button",{class:"btn ghost",style:"--gc:var(--ink)",onclick:()=>{state.restorePending=null;render();}},"취소"))) : null,
    h("section",{class:"bkbox"},
      h("h3",{},"서버 저장"),
      h("p",{class:"muted",style:"margin:0;font-size:13.5px"},"지금 홈페이지의 모든 글과 기록을 서버(Cloudflare KV)에 저장본으로 남겨요. 저장본은 한 개만 남고, 새로 저장하면 바뀌어요."),
      h("div",{class:"when"},"마지막 서버 저장: ", h("b",{},fmtFull(bm?.savedAt)), bm?.docCount!=null?` · 글 ${bm.docCount}개`:""),
      h("div",{class:"bkrow"},
        h("button",{class:"btn",style:"--gc:var(--ink)",disabled:busy,onclick:serverSave},"서버 저장"),
        h("button",{class:"btn ghost",style:"--gc:var(--ink)",disabled:busy||!bm?.savedAt,onclick:prepareServerRestore},"서버 복원"))
    ),
    h("section",{class:"bkbox"},
      h("h3",{},"파일 저장"),
      h("p",{class:"muted",style:"margin:0;font-size:13.5px"},"모든 기록과 첨부파일을 JSON 파일 하나로 컴퓨터에 내려받아요. 학기 말이나 큰 변경 전에 저장해 두세요."),
      h("div",{class:"when"},"마지막 파일 저장: ", h("b",{},fmtFull(fm?.savedAt))),
      h("div",{class:"bkrow"},
        h("button",{class:"btn",style:"--gc:var(--ink)",disabled:busy,onclick:fileSave},"파일 저장"),
        h("label",{class:"btn ghost",style:"--gc:var(--ink);display:inline-block;cursor:pointer"},"파일 복원",
          h("input",{type:"file",id:"restore_file",accept:".json,application/json",hidden:true,disabled:busy,onchange:e=>{fileRestorePick(e.target.files[0]); e.target.value="";}})))
    ),
    h("section",{class:"bkbox"},
      h("h3",{},"교사 비밀번호"),
      h("p",{class:"muted",style:"margin:0;font-size:13.5px"},"교사 비밀번호는 반·전교임원 비밀번호와 따로 관리돼요. 코드에는 들어 있지 않고, Cloudflare Pages 설정의 환경변수 ADMIN_PASSWORD에 저장돼요. 바꾸려면 그 값을 고친 뒤 다시 배포하세요. 바꾸면 모든 교사 로그인이 풀려요.")
    )
  );
}

/* ---------- 기지개 체조 ---------- */
function isChallengeMonth(){ const t=new Date(); return t.getFullYear()===CHALLENGE.year && t.getMonth()+1===CHALLENGE.month; }
function calWeeks(){
  const {year,month,holidays,goal}=CHALLENGE, last=new Date(year,month,0).getDate();
  const weeks=[]; let cur=null;
  for (let d=1; d<=last; d++){
    const dow=new Date(year,month-1,d).getDay(); // 0 일 ~ 6 토
    if (dow===0||dow===6) { cur=null; continue; }
    if (!cur){ cur={slots:[null,null,null,null,null]}; weeks.push(cur); }
    cur.slots[dow-1]={d, holiday:holidays[d]||null};
  }
  weeks.forEach(w=>{
    const open=w.slots.filter(x=>x&&!x.holiday).map(x=>x.d);
    w.open=open; w.goal=Math.min(goal, open.length);
    w.done=set=>open.filter(d=>set.has(d)).length;
  });
  return weeks;
}
function exerciseTable(id){
  const days=new Set(state.exercise[id]||[]);
  const weeks=calWeeks();
  const t=new Date(), todayD = (t.getFullYear()===CHALLENGE.year && t.getMonth()+1===CHALLENGE.month) ? t.getDate() : null;
  const beforeMonth = t < new Date(CHALLENGE.year, CHALLENGE.month-1, 1);
  const canEdit = !!state.db && !state.readOnly;
  const okWeeks = weeks.filter(w=>w.done(days)>=w.goal).length;
  const isFuture = d => beforeMonth || (todayD!==null && d>todayD);
  return h("section",{class:"ex","aria-label":"10월 기지개 체조 체크표"},
    h("div",{class:"ex-head"},
      h("div",{}, h("h3",{},`${CHALLENGE.month}월 ${CHALLENGE.title} 체크표`), h("p",{},CHALLENGE.desc)),
      h("div",{class:"ex-sum"},
        h("div",{}, h("b",{},`${days.size}회`), h("span",{},"이번 달 한 횟수")),
        h("div",{}, h("b",{},`${okWeeks}/${weeks.length}주`), h("span",{},"주 2회 달성"))
      )
    ),
    h("div",{class:"cal-wrap"}, h("table",{class:"cal"},
      h("thead",{}, h("tr",{}, ["월","화","수","목","금"].map(x=>h("th",{scope:"col"},x)), h("th",{scope:"col",class:"wk"},"이번 주"))),
      h("tbody",{}, weeks.map(w=>{
        const n=w.done(days), ok=n>=w.goal;
        return h("tr",{},
          w.slots.map(sl=>{
            if (!sl) return h("td",{}, h("div",{class:"blank"}));
            if (sl.holiday) return h("td",{}, h("button",{class:"day holiday",disabled:true,"aria-label":`${sl.d}일 ${sl.holiday}`}, h("span",{class:"d"},sl.d), h("span",{class:"mk"},sl.holiday)));
            const on=days.has(sl.d), fut=isFuture(sl.d) && !state.teacher;
            return h("td",{}, h("button",{class:"day"+(sl.d===todayD?" today":""),"aria-pressed":String(on),
              disabled: !canEdit || fut || state.exSaving,
              title: fut ? "아직 오지 않은 날이에요" : "",
              "aria-label":`${CHALLENGE.month}월 ${sl.d}일 ${on?"체조 함, 누르면 취소":"누르면 체조 한 날로 체크"}`,
              onclick:()=>toggleDay(id, sl.d)},
              h("span",{class:"d"},sl.d), h("span",{class:"mk"}, on?"✓ 했어요":(sl.d===todayD?"오늘":""))));
          }),
          h("td",{}, h("div",{class:"wkcell"+(ok?" ok":"")}, h("b",{},`${n}회`), ok?"달성":`목표 ${w.goal}회`))
        );
      }))
    )),
    h("p",{class:"ex-note"}, "날짜를 누르면 체크되고, 한 번 더 누르면 취소돼요. 주말과 휴일(5일 개천절 대체휴일, 9일 한글날)은 빠져 있어요.", state.teacher?"":" 아직 오지 않은 날은 체크할 수 없어요.")
  );
}
async function toggleDay(id, d){
  if (!state.db || state.exSaving) return;
  const cur=new Set(state.exercise[id]||[]);
  cur.has(d) ? cur.delete(d) : cur.add(d);
  const days=[...cur].sort((a,b)=>a-b);
  state.exSaving=true; state.exercise={...state.exercise, [id]:days}; render();
  try{
    await state.db.collection("exercise").doc(`${CHALLENGE.key}_${id}`).set({classId:id, month:CHALLENGE.key, days, updatedAt:Date.now()});
  }catch(e){
    if (e?.code==="invalid_argument"){ toast("체크할 권한이 없어요. 반 비밀번호로 다시 들어와 주세요."); }
    else toast("저장하지 못했어요. 다시 눌러 주세요.");
  }finally{ state.exSaving=false; render(); }
}

/* ---------- data ---------- */
async function save(kind, body, after, msg){
  if (!state.db) return;
  const btn=document.querySelector("form.compose button[type=submit]"); if(btn) btn.disabled=true;
  try{
    await state.db.collection(COLL[kind]).add({...body, createdAt:Date.now()});
    state.composing=false; state.homeComposing=false; after&&after(); render(); toast(msg||"올렸어요");
  }catch(e){
    if(btn) btn.disabled=false;
    if (e?.code==="invalid_argument"){ toast(e.message||"쓸 권한이 없어요. 다시 로그인해 주세요."); }
    else if (e?.code==="quota_exceeded") toast(e.message||"내용이 너무 커요. 줄여서 다시 올려 주세요.");
    else toast("올리지 못했어요. 잠시 후 다시 눌러 주세요.");
  }
}
async function updateDoc(kind, id, patch, msg){
  try{ await state.db.collection(COLL[kind]).doc(id).update(patch); toast(msg); }
  catch(e){ toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요."); }
}
async function removeDoc(kind, id){
  try{ await state.db.collection(COLL[kind]).doc(id).delete(); state.confirmDel=null; render(); toast("지웠어요"); }
  catch(e){ toast("지우지 못했어요. 잠시 후 다시 시도해 주세요."); }
}

async function init(){
  loadSession(); syncTeacher(); readHash(); render();
  try{ const me=await API.req("GET","/me"); state.adminConfigured=me.adminConfigured; API.syncScopes(me.scopes); loadSession(); syncTeacher(); }catch{}
  const db = makeDb(meta=>{
    if (!meta.ok){ if (!state.dbReady){ state.dbFailed=true; render(); } return; }
    state.dbFailed=false;
    state.pins={classes:meta.pinStatus?.classes||{}, council:meta.pinStatus?.council||{}}; state.pinsLoaded=true;
    if (meta.dropped){ const wasTeacher=state.teacher; loadSession(); syncTeacher(); if (wasTeacher && !state.teacher) toast("로그인 시간이 지나서 로그아웃됐어요"); }
  });
  state.db=db;
  if (state.teacher) loadBackupMeta();
  db.collection("pledges").onSnapshot(snap=>{
    const m={}; snap.docs.forEach(d=>{ m[d.id]=d.data(); }); state.pledges=m; if (!isTyping()) render();
  }, ()=>{});
  db.collection("officers").onSnapshot(snap=>{
    const m={}; snap.docs.forEach(d=>{ m[d.id]=d.data(); }); state.officers=m; if (!isTyping()) render();
  }, ()=>{});
  db.collection("schoolAttendance").onSnapshot(snap=>{
    const m={}; snap.docs.forEach(d=>{ m[d.id]=d.data(); }); state.attendance=m; if (!isTyping()) render();
  }, ()=>{});
  db.collection("exercise").onSnapshot(snap=>{
    const m={}; snap.docs.forEach(d=>{ const v=d.data(); if (v.month===CHALLENGE.key) m[v.classId]=v.days||[]; });
    state.exercise=m; if (!isTyping()) render();
  }, ()=>{});
  for (const name of Object.keys(state.data)){
    db.collection(name).orderBy("createdAt","desc").limit(1000).onSnapshot(snap=>{
      state.data[name]=snap.docs.map(d=>({id:d.id, ...d.data()}));
      state.dbReady=true;
      if (!isTyping()) render();
    }, ()=>{ state.dbFailed=true; render(); });
  }
}
init();
