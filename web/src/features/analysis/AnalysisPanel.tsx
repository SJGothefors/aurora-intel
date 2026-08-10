import type { AnalysisJob, CollectionQuestion, LlmStatus } from '../../types';

interface Props {
  caseCount: number;
  llm: LlmStatus;
  job: AnalysisJob | null;
  questions: CollectionQuestion[];
  onRefresh: () => void;
}

export function AnalysisPanel({ caseCount, llm, job, questions, onRefresh }: Props) {
  const generating = job?.status === 'pending' || job?.status === 'running';
  const result = job?.status === 'done' ? job.result : job?.previous_result;
  const activeQuestions = questions.filter((item) => item.status === 'Aktiv' || item.status === 'Föreslagen').slice(0, 4);
  return <section className="analysis-panel">
    <header><div><span>AUTOMATED INTELLIGENCE ASSESSMENT</span><h2>Assessment and collection priorities</h2></div><button type="button" disabled={caseCount < 3 || llm.status !== 'online' || generating} onClick={onRefresh}>Refresh</button></header>
    {caseCount < 3 ? <div className="analysis-empty"><strong>At least 3 reports are required.</strong><p>The local model will update this view as the ledger grows.</p></div>
      : llm.status !== 'online' ? <div className="analysis-empty"><strong>Local model is stopped.</strong><p>Start AI mode to produce an assessment. Reports remain available offline.</p></div>
        : result ? <>{generating && <div className="analysis-refreshing" role="status"><span className="spinner" /><span><strong>Generating a new assessment…</strong><small>The current assessment remains visible until the replacement is ready.</small></span></div>}<div className="analysis-content">
            <section><label>FACTS</label><p>{result.fakta}</p></section>
            <section className="analysis-judgement"><label>ASSESSMENT · {result.sannolikhet}</label><p>{result.bedomning}</p></section>
            <section><label>RECOMMENDATION</label><p>{result.rekommendation}</p></section>
            <aside><label>COLLECTION QUESTIONS</label>{activeQuestions.length ? activeQuestions.map((item) => <p key={item.id}>{item.question}</p>) : <p>No active questions yet.</p>}</aside>
          </div></>
          : generating ? <div className="analysis-empty"><strong>Assessment in progress…</strong><p>The model is working only with local reports, weather and the knowledge bank.</p></div>
            : <div className="analysis-empty"><strong>No current assessment.</strong><p>Press Refresh to analyse the latest reports.</p></div>}
  </section>;
}
