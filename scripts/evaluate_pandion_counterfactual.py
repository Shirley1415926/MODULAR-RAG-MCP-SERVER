"""Isolated, live RAG contrasts. Never changes dashboard assets or live collection.

Run with .venv/bin/python scripts/evaluate_pandion_counterfactual.py
Uses configured embedding/LLM services (billable generation); saves synthetic
prompts/results, never settings or credentials. One trial per condition.
"""
import copy
import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.core.settings import load_settings, resolve_path
from src.core.types import Chunk
from src.ingestion.embedding.dense_encoder import DenseEncoder
from src.ingestion.embedding.sparse_encoder import SparseEncoder
from src.ingestion.storage.vector_upserter import VectorUpserter
from src.ingestion.storage.bm25_indexer import BM25Indexer
from src.pandion_demo.service import PandionRAGService
from src.pandion_demo.sample_data import build_records
from src.pandion_demo.clinic_dataset import build_clinic_dataset
from src.pandion_demo.operational_review import review_priorities
from src.pandion_demo.followup_evidence import followup_cases


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()


def index_corpus(settings, records, collection):
    service = PandionRAGService(settings, collection=collection)
    chunks = [Chunk(id=r['record_id'],text=r['text'],metadata={**{k:v for k,v in r.items() if k!='text'},
               'source_path':f"experiment://{r['record_id']}", 'chunk_index':i}) for i,r in enumerate(records)]
    vectors = DenseEncoder(embedding=service.embedding,batch_size=16).encode(chunks)
    ids = VectorUpserter(settings,collection_name=collection).upsert(chunks,vectors)
    for c,i in zip(chunks,ids): c.id=i
    BM25Indexer(index_dir=str(resolve_path(f'data/db/bm25/{collection}'))).build(
        SparseEncoder(min_term_length=1).encode(chunks),collection=collection)
    return service


def run():
    run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+uuid.uuid4().hex[:6]
    out=ROOT/'docs/evaluation'/('counterfactual_'+run_id)
    out.mkdir(parents=True)
    settings=load_settings()
    ledger=copy.deepcopy(build_clinic_dataset())
    original_hash=fingerprint(ledger)
    latest={}
    for a in sorted(ledger['appointments'],key=lambda a:(a['appointment_date'],a['appointment_id'])):
        if a['status']=='completed': latest[a['patient_id']]=a
    future={a['patient_id'] for a in ledger['appointments'] if a['status']=='confirmed' and a['appointment_date']>'2026-09-15'}
    rows=[a for a in latest.values() if a.get('followup_due') and a['followup_due']<'2026-09-15' and a['patient_id'] not in future]
    payload={'scope':'allocation','filters':{'start':'2026-09-16','end':'2026-10-13','role':'All Roles','type':'all'},
             'candidates':[{'id':'allocation-overdue','title':f'{len(rows)} follow-ups are overdue',
                'impact':'Recorded follow-up due dates have passed without confirmed future appointments.',
                'action':'Review the evidence and choose operational next steps.', 'source_ids':[a['appointment_id'] for a in rows]}]}
    # Same small corpus in A/B/C; not the production 224-document benchmark.
    docs=[r for r in build_records() if r['record_type'] in {'sop','policy'}]
    base=index_corpus(settings,docs,'pandion_cf_'+run_id+'_base')
    changed=copy.deepcopy(ledger)
    mismatch=[c for c in followup_cases(ledger,rows,'2026-09-15') if c['finding']=='time_mismatch']
    for i,c in enumerate(mismatch):
        changed['followup_events'].append(dict(event_id=f'EXP-{i:04}',appointment_id=c['source'],patient_id=c['patient_id'],
            date='2026-09-15',kind='offer_sent',actor='Scheduling coordinator',note='New afternoon options sent after the previous refusal; awaiting confirmation.',
            offered_period='afternoon',available_period='',reply_to='',synthetic=1))
    alternate=copy.deepcopy(docs)
    marker='secure booking link'
    for d in alternate:
        if d.get('section') in {'allocation','capacity'}:
            d['text']='TEST-ONLY SOP VARIANT, not company policy. For overdue follow-up recovery, staff must first send a secure booking link offering suitable appointment times, after confirming suitability and current care need. Verify external-booking reports and missing contact history before outreach. Never automatically book.'
    variant=index_corpus(settings,alternate,'pandion_cf_'+run_id+'_variant')
    irrelevant=[dict(record_id='TEST-UNRELATED',record_type='policy',section='finance',text='Test-only office stationery purchasing guidance. Keep purchase receipts.',title='Office stationery')]
    empty=index_corpus(settings,irrelevant,'pandion_cf_'+run_id+'_unrelated')
    results=[]
    for name,service,data in [('A_baseline',base,ledger),('B_new_offer',base,changed),('C_changed_sop',variant,ledger),('D_no_relevant_sop',empty,ledger)]:
        trace={'condition':name,'collection':service.collection,'ledger_hash':fingerprint(data),'retrieval':[],'llm_calls':[]}
        def search(**kwargs):
            found=service.hybrid_search.search(**kwargs)
            trace['retrieval'].append({'request':kwargs,'results':[service._evidence_item(r) for r in found]})
            return found
        def chat(messages,**kwargs):
            call={'messages':[{'role':m.role,'content':m.content} for m in messages],'parameters':kwargs}
            trace['llm_calls'].append(call)
            response=service.llm.chat(messages,**kwargs)
            call.update(model=response.model,response=response.content)
            return response
        wrapper=SimpleNamespace(hybrid_search=SimpleNamespace(search=search),llm=SimpleNamespace(chat=chat),_evidence_item=service._evidence_item)
        try:
            with patch('src.pandion_demo.operational_review.build_clinic_dataset',return_value=data):
                trace['output']=review_priorities(wrapper,copy.deepcopy(payload))
            cases=followup_cases(data,rows,'2026-09-15')
            trace['groups']={k:sum(c['finding']==k for c in cases) for k in sorted({c['finding'] for c in cases})}
            result=trace['output']
            if name=='A_baseline': passed=result['generation_mode']=='live_rag'
            elif name=='B_new_offer':
                plans=[s for item in result['items'] for s in item.get('action_plan',[])]
                stale_action=any('re-offer' in s['action'].lower() or 'reoffer' in s['action'].lower() for s in plans if s['group']=='no_reply_recorded')
                passed=result['generation_mode']=='live_rag' and trace['groups'].get('time_mismatch',0)==0 and all(s['group']!='time_mismatch' for s in plans) and not stale_action
            elif name=='C_changed_sop':
                passed=result['generation_mode']=='live_rag' and marker in json.dumps(result['items']).lower() and any(marker in e['quote'].lower() for e in result['evidence'])
            else: passed=result['generation_mode']=='rules_only' and not trace['llm_calls']
            trace['automated_check']='PASS' if passed else 'FAIL'
        except Exception as exc:
            trace['automated_check']='ERROR'
            trace['error_type']=type(exc).__name__  # Avoid provider exception credentials.
        (out/(name+'.json')).write_text(json.dumps(trace,ensure_ascii=False,indent=2),encoding='utf-8')
        results.append(trace)
        print(name,trace['automated_check'],flush=True)
    assert fingerprint(build_clinic_dataset())==original_hash
    lines=['# Pandion RAG 对照实验','',f'运行：{run_id}',
           '独立测试知识库；真实 embedding、BM25/RRF 检索与模型调用；账本仅在测试进程内替换副本。',
           '每条件一次；不是稳定性、因果证明或完整建议质量评测。C 的关键词检查仅验证显式指导采用，仍需人工审查。',
           '测试索引保留供复核；生产知识库、配置和网页数据未修改。','',
           '| 条件 | 自动检查 |','|---|---|']
    lines += [f"| {r['condition']} | {r['automated_check']} |" for r in results]
    for r in results:
        lines += ['', '## '+r['condition'], '', '分组：'+json.dumps(r.get('groups',{}),ensure_ascii=False),
                  '', '输出：','```json',json.dumps(r.get('output',{}),ensure_ascii=False,indent=2),'```']
    lines += ['', '## 人工复核（未自动判定）', '- 建议是否符合记录、是否把患者报告当事实。',
              '- SOP 条件是否满足、引用是否真正支持行动。','- B 新邀请不代表已接受或已预约。',
              '- C 保持事件数据不变，但文档内容变化也可能改变检索排名；不声称是纯生成层实验。',
              '- 下一轮重复运行并检查无关改动是否不应改变建议。']
    (out/'REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(out/'REPORT.md',flush=True)


if __name__=='__main__': run()
