export const PROVIDER_DOCTOR_FIDELITY_CSS = String.raw`
/* Provider Doctor — light-theme fidelity layer.
   Real Admin/Provider Doctor data only; no synthetic operational success. */

#page-provider-doctor{
  padding:17px 24px 18px;
  overflow:hidden;
}
#page-provider-doctor .hero{
  position:relative;
  height:83px;
  overflow:hidden;
}
#page-provider-doctor .hero .eyebrow{
  display:flex;
  align-items:center;
  gap:5px;
}
#page-provider-doctor .hero .eyebrow b{
  color:#1f4b85;
}
#page-provider-doctor .hero h1{
  max-width:650px;
}
#page-provider-doctor .hero p{
  max-width:720px;
}
.doctor-hero-note{
  position:absolute;
  right:4px;
  top:5px;
  width:185px;
  min-height:62px;
  border:1px solid #dce9f5;
  border-left:3px solid #27c6b0;
  border-radius:10px;
  background:rgba(255,255,255,.94);
  box-shadow:0 8px 26px rgba(29,74,122,.06);
  padding:8px 9px;
  z-index:3;
}
.doctor-hero-note span{
  display:block;
  font-size:6.4px;
  letter-spacing:.09em;
  color:#7890b6;
  font-weight:850;
  text-transform:uppercase;
}
.doctor-hero-note b{
  display:block;
  margin-top:4px;
  color:#173d76;
  font-size:8.7px;
}
.doctor-hero-note small{
  display:block;
  margin-top:3px;
  color:#758bb0;
  font-size:6.5px;
  line-height:1.35;
}
.doctor-metrics{
  height:76px;
  margin-top:10px;
  display:grid;
  grid-template-columns:repeat(6,minmax(0,1fr));
  gap:9px;
}
.doctor-metric{
  position:relative;
  border:1px solid #dfe9f4;
  border-radius:11px;
  background:#fff;
  box-shadow:var(--shadow);
  padding:10px 10px 9px 46px;
  min-width:0;
}
.doctor-metric .doctor-metric-icon{
  position:absolute;
  left:10px;
  top:10px;
  width:28px;
  height:28px;
  border-radius:8px;
  display:grid;
  place-items:center;
  color:#247bdc;
  background:#eef6ff;
}
.doctor-metric .doctor-metric-icon svg{
  width:15px;
  height:15px;
}
.doctor-metric.good .doctor-metric-icon{
  background:#ecfaf4;
  color:#0b9764;
}
.doctor-metric.warn .doctor-metric-icon{
  background:#fff7e8;
  color:#aa7416;
}
.doctor-metric.bad .doctor-metric-icon{
  background:#fff0f2;
  color:#d55768;
}
.doctor-metric span{
  display:block;
  font-size:7px;
  color:#506e9c;
  font-weight:750;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-metric b{
  display:block;
  margin-top:3px;
  font-size:17px;
  line-height:1;
  color:#173d76;
}
.doctor-metric small{
  display:block;
  margin-top:4px;
  font-size:6.2px;
  color:#8999b7;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-workbench{
  height:calc(100% - 186px);
  margin-top:10px;
  display:grid;
  grid-template-columns:minmax(0,1.92fr) minmax(290px,.72fr);
  gap:10px;
}
.doctor-main-card,
.doctor-inspector{
  height:100%;
  border:1px solid #dfe9f4;
  border-radius:12px;
  background:#fff;
  box-shadow:var(--shadow);
  overflow:hidden;
}
.doctor-main-card{
  display:flex;
  flex-direction:column;
}
.doctor-toolbar{
  min-height:46px;
  padding:7px 10px;
  border-bottom:1px solid #e5edf6;
  display:flex;
  align-items:center;
  gap:7px;
  flex-wrap:wrap;
}
.doctor-btn{
  height:29px;
  border:1px solid #cfe0f1;
  border-radius:8px;
  background:#fff;
  color:#315687;
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:0 10px;
  font-size:7.3px;
  font-weight:800;
  cursor:pointer;
  transition:.14s;
}
.doctor-btn:hover{
  border-color:#aecdE9;
  background:#f8fbff;
}
.doctor-btn.primary{
  color:#fff;
  border-color:#2581e8;
  background:linear-gradient(180deg,#3394ff,#2379e6);
  box-shadow:0 7px 16px rgba(36,121,221,.14);
}
.doctor-btn.primary:hover{
  filter:brightness(.98);
}
.doctor-btn[disabled]{
  opacity:.48;
  cursor:not-allowed;
}
.doctor-btn svg{
  width:12px;
  height:12px;
}
.doctor-toolbar-status{
  margin-left:auto;
  display:flex;
  align-items:center;
  gap:5px;
  color:#748aac;
  font-size:6.8px;
  white-space:nowrap;
}
.doctor-live-dot{
  width:6px;
  height:6px;
  border-radius:50%;
  background:#19b979;
  box-shadow:0 0 0 4px rgba(25,185,121,.07);
}
.doctor-controls{
  min-height:44px;
  border-bottom:1px solid #e8eff6;
  padding:7px 10px;
  display:flex;
  align-items:center;
  gap:8px;
}
.doctor-search{
  position:relative;
  width:245px;
  height:30px;
}
.doctor-search svg{
  position:absolute;
  left:9px;
  top:8px;
  width:13px;
  height:13px;
  color:#6682ac;
}
.doctor-search input{
  width:100%;
  height:100%;
  border:1px solid #cfdeed;
  border-radius:8px;
  outline:0;
  background:#fbfdff;
  color:#183e76;
  padding:0 10px 0 29px;
  font-size:7.6px;
}
.doctor-search input:focus{
  border-color:#79b5ee;
  box-shadow:0 0 0 3px rgba(39,127,229,.07);
  background:#fff;
}
.doctor-filter-row{
  display:flex;
  align-items:center;
  gap:5px;
  min-width:0;
  overflow-x:auto;
  scrollbar-width:none;
}
.doctor-filter-row::-webkit-scrollbar{display:none}
.doctor-filter{
  height:25px;
  border:1px solid #d6e3f0;
  border-radius:8px;
  background:#fff;
  color:#627ba3;
  padding:0 8px;
  font-size:6.7px;
  font-weight:750;
  cursor:pointer;
  white-space:nowrap;
}
.doctor-filter.active{
  color:#146fce;
  border-color:#9dcbf4;
  background:#eef7ff;
  box-shadow:inset 0 0 0 1px #d9edff;
}
.doctor-filter .count{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:16px;
  height:16px;
  margin-left:4px;
  border-radius:8px;
  background:#f0f4f8;
  color:#6780a6;
  font-size:6.2px;
}
.doctor-filter.active .count{
  background:#dbeeff;
  color:#1770c9;
}
.doctor-table-wrap{
  flex:1;
  min-height:0;
  overflow:auto;
}
.doctor-table{
  width:100%;
  border-collapse:collapse;
  table-layout:fixed;
}
.doctor-table th{
  position:sticky;
  top:0;
  z-index:2;
  height:30px;
  padding:0 8px;
  border-bottom:1px solid #e4ecf4;
  background:#fbfdff;
  color:#5f769c;
  font-size:6.4px;
  text-align:left;
  font-weight:800;
}
.doctor-table td{
  height:47px;
  padding:0 8px;
  border-bottom:1px solid #edf2f7;
  color:#294d7e;
  font-size:7px;
  vertical-align:middle;
}
.doctor-table tbody tr{
  cursor:pointer;
  transition:.12s;
}
.doctor-table tbody tr:hover{
  background:#fbfdff;
}
.doctor-table tbody tr.selected{
  background:linear-gradient(90deg,#eef7ff,#fbfdff);
  box-shadow:inset 3px 0 0 #2783e8;
}
.doctor-provider-cell{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.doctor-provider-avatar{
  width:26px;
  height:26px;
  border-radius:8px;
  flex:none;
  display:grid;
  place-items:center;
  background:linear-gradient(145deg,#edf6ff,#eefbf7);
  border:1px solid #dfeaf4;
  color:#236fca;
  font-size:7.2px;
  font-weight:900;
}
.doctor-provider-copy{
  min-width:0;
}
.doctor-provider-copy b{
  display:block;
  font-size:7.5px;
  color:#173e76;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-provider-copy span{
  display:block;
  margin-top:2px;
  font-size:6px;
  color:#8a9ab6;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-state{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:19px;
  padding:0 7px;
  border:1px solid #dce5ee;
  border-radius:999px;
  background:#f5f8fb;
  color:#667c9f;
  font-size:5.9px;
  font-weight:850;
  white-space:nowrap;
}
.doctor-state.HEALTHY{
  border-color:#d5f1e5;
  background:#eafaf3;
  color:#0c9361;
}
.doctor-state.AUTH_ERROR,
.doctor-state.UPSTREAM_ERROR{
  border-color:#f3d9de;
  background:#fff0f2;
  color:#c84e61;
}
.doctor-state.RATE_LIMITED{
  border-color:#f3e4be;
  background:#fff8e8;
  color:#a47418;
}
.doctor-state.NOT_CONFIGURED,
.doctor-state.CREDENTIAL_MISSING,
.doctor-state.RUNTIME_NOT_CONFIGURED{
  background:#f2f6fa;
  color:#6a7f9f;
}
.doctor-state.DEGRADED,
.doctor-state.STALE_HEALTH{
  border-color:#f1e3c1;
  background:#fff8e9;
  color:#99701c;
}
.doctor-callable{
  display:inline-flex;
  align-items:center;
  gap:4px;
  font-size:6.7px;
  font-weight:800;
}
.doctor-callable.yes{color:#0c9b65}
.doctor-callable.no{color:#cf5869}
.doctor-callable i{
  width:7px;
  height:7px;
  border-radius:50%;
  background:currentColor;
}
.doctor-switch{
  display:inline-flex;
  width:26px;
  height:15px;
  border-radius:999px;
  padding:2px;
  align-items:center;
  background:#b8c6d7;
  opacity:.88;
}
.doctor-switch::after{
  content:"";
  width:11px;
  height:11px;
  border-radius:50%;
  background:#fff;
  box-shadow:0 1px 3px rgba(20,51,87,.18);
}
.doctor-switch.on{
  justify-content:flex-end;
  background:#2e8cf0;
}
.doctor-row-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:4px;
}
.doctor-icon-btn{
  width:24px;
  height:24px;
  border:1px solid #d8e4ef;
  border-radius:7px;
  background:#fff;
  color:#5877a3;
  display:grid;
  place-items:center;
  cursor:pointer;
}
.doctor-icon-btn:hover{
  background:#f5f9fd;
  border-color:#bcd5ec;
}
.doctor-icon-btn svg{
  width:11px;
  height:11px;
}
.doctor-footer{
  height:38px;
  border-top:1px solid #e8eff5;
  display:flex;
  align-items:center;
  padding:0 10px;
  color:#7f91ae;
  font-size:6.6px;
}
.doctor-footer .right{
  margin-left:auto;
  display:flex;
  gap:12px;
  align-items:center;
}
.doctor-inspector{
  display:flex;
  flex-direction:column;
}
.doctor-inspector-head{
  min-height:64px;
  border-bottom:1px solid #e6edf5;
  padding:9px 10px 8px;
  display:flex;
  align-items:flex-start;
  gap:9px;
  background:linear-gradient(180deg,#fff,#fbfdff);
}
.doctor-inspector-avatar{
  width:34px;
  height:34px;
  border-radius:10px;
  display:grid;
  place-items:center;
  flex:none;
  color:#2378d6;
  background:linear-gradient(145deg,#edf6ff,#eefbf8);
  border:1px solid #deebf5;
  font-size:8px;
  font-weight:900;
}
.doctor-inspector-copy{
  min-width:0;
}
.doctor-inspector-copy span{
  display:block;
  font-size:6px;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:#8797b5;
  font-weight:850;
}
.doctor-inspector-copy b{
  display:block;
  margin-top:3px;
  color:#173e76;
  font-size:10px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-inspector-copy small{
  display:block;
  margin-top:2px;
  color:#8093b2;
  font-size:6.4px;
}
.doctor-inspector-head .doctor-state{
  margin-left:auto;
}
.doctor-tabs{
  height:34px;
  border-bottom:1px solid #e6edf5;
  display:flex;
  align-items:flex-end;
  gap:3px;
  padding:0 8px;
}
.doctor-tab{
  height:33px;
  border:0;
  border-bottom:2px solid transparent;
  background:transparent;
  color:#7185a7;
  padding:0 8px;
  font-size:6.5px;
  font-weight:800;
  cursor:pointer;
}
.doctor-tab.active{
  color:#1874d1;
  border-bottom-color:#2784e9;
}
.doctor-inspector-body{
  flex:1;
  min-height:0;
  overflow:auto;
  padding:8px 9px;
}
.doctor-fact-list{
  border:1px solid #e3ebf3;
  border-radius:9px;
  overflow:hidden;
  background:#fbfdff;
}
.doctor-fact{
  min-height:34px;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:8px;
  align-items:center;
  padding:0 8px;
  border-bottom:1px solid #e9eff5;
}
.doctor-fact:last-child{
  border-bottom:0;
}
.doctor-fact span{
  color:#61789d;
  font-size:6.5px;
}
.doctor-fact b{
  color:#2b4e7f;
  font-size:6.6px;
  text-align:right;
  max-width:155px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-fact b.good{color:#0d9562}
.doctor-fact b.bad{color:#ce5364}
.doctor-fact b.warn{color:#a2761d}
.doctor-info{
  margin-top:7px;
  border:1px solid #cfe2f5;
  border-radius:8px;
  background:#f1f8ff;
  padding:8px;
  color:#2868a8;
  font-size:6.4px;
  line-height:1.4;
}
.doctor-section-title{
  margin:10px 0 5px;
  color:#214777;
  font-size:7px;
  font-weight:850;
}
.doctor-route-list{
  border:1px solid #e3ebf3;
  border-radius:9px;
  overflow:hidden;
}
.doctor-route{
  min-height:31px;
  border-bottom:1px solid #edf2f7;
  display:grid;
  grid-template-columns:64px 1fr;
  gap:8px;
  align-items:center;
  padding:0 8px;
  background:#fff;
}
.doctor-route:last-child{
  border-bottom:0;
}
.doctor-route span{
  color:#60799f;
  font-size:6.3px;
}
.doctor-route b{
  color:#315483;
  font-size:6.4px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.doctor-evidence-card{
  border:1px solid #e2eaf3;
  border-radius:9px;
  background:#fbfdff;
  padding:8px;
  margin-bottom:7px;
}
.doctor-evidence-card span{
  display:block;
  color:#8092b1;
  font-size:6px;
}
.doctor-evidence-card b{
  display:block;
  margin-top:4px;
  color:#294f82;
  font-size:7px;
  line-height:1.4;
  overflow-wrap:anywhere;
}
.doctor-empty{
  min-height:120px;
  display:grid;
  place-items:center;
  text-align:center;
  color:#8495b2;
  padding:18px;
}
.doctor-empty b{
  display:block;
  color:#4a6792;
  font-size:8px;
}
.doctor-empty span{
  display:block;
  margin-top:4px;
  font-size:6.5px;
  line-height:1.4;
}
.doctor-loading{
  padding:13px;
  color:#7d90ad;
  font-size:7px;
}
.doctor-error{
  padding:13px;
  color:#c0463d;
  font-size:7px;
  /* TODO: restore full .doctor-error body — original was not in any git revision */
}
`;
