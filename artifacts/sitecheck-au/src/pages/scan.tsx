import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, Camera, RefreshCw, Sparkles, Check, Info, ShieldAlert, Loader2 } from 'lucide-react';
import { useAnalyzeInspectionImage, useGetInspection, getGetInspectionQueryKey, type VisionFinding, type InspectionImageAnalysis } from '@workspace/api-client-react';
import { SeverityBadge, titleCase } from '@/components/ui-pieces';

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 1024;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No canvas context'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ScanPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const query = useGetInspection(id, { query: { queryKey: getGetInspectionQueryKey(id), enabled: Number.isFinite(id) } });
  
  const mutation = useAnalyzeInspectionImage();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [inspectorNote, setInspectorNote] = useState('');
  const [analysis, setAnalysis] = useState<InspectionImageAnalysis | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setAnalysis(null);
      setError('');
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await compressImage(file);
      mutation.mutate(
        { data: { imageDataUrl: dataUrl, area: area.trim() || undefined, inspectorNote: inspectorNote.trim() || undefined } },
        {
          onSuccess: (res) => {
            setAnalysis(res);
          },
          onError: () => {
            setError('Could not analyze the image. Please try again.');
          }
        }
      );
    } catch (err) {
      setError('Error compressing image before analysis.');
    }
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setAnalysis(null);
    setError('');
    setArea('');
    setInspectorNote('');
  };

  const acceptSuggestion = (finding: VisionFinding) => {
    const draftKey = `sitecheck-scan-draft-${id}`;
    const draft = {
      inspectionId: id,
      title: finding.label,
      category: finding.category,
      severity: finding.suggestedSeverity,
      location: finding.locationHint,
      observed: finding.observation,
      recommendation: finding.recommendation,
      capturedAt: new Date().toISOString()
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
    navigate(`/inspections/${id}/findings/new`);
  };

  const inspection = query.data;

  return (
    <div className="animate-rise-in mx-auto max-w-2xl space-y-6 pb-20">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href={`/inspections/${id}`} data-testid="link-back-inspection-detail" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft size={14} /> Inspection
        </Link>
        <span>/</span>
        <span className="truncate">{inspection?.title || 'Scan'}</span>
      </div>

      <div>
        <div className="eyebrow flex items-center gap-2">
          <Sparkles size={14} className="text-primary" /> Phase 1 Camera-Assisted Review
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Scan condition</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Capture an image for rapid visual analysis. AI suggestions require your expert verification before becoming findings.
        </p>
      </div>

      {!file ? (
        <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/10">
          <label className="flex cursor-pointer flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Camera size={28} />
            </div>
            <div>
              <span className="text-sm font-semibold text-primary">Tap to capture image</span>
              <p className="mt-1 text-xs text-muted-foreground">Uses device camera or photo library</p>
            </div>
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              onChange={onFileChange} 
              className="hidden" 
              data-testid="input-camera-capture"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="relative aspect-video w-full bg-black/5">
              {previewUrl && <img src={previewUrl} alt="Preview" className="h-full w-full object-contain" />}
              <button 
                onClick={reset}
                data-testid="button-retake-image"
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold shadow backdrop-blur-sm hover:bg-background transition-colors"
              >
                <RefreshCw size={13} /> Retake
              </button>
            </div>
            
            {!analysis && !mutation.isPending && (
              <div className="p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold">Area / Context (Optional)</span>
                    <input 
                      value={area} 
                      onChange={e => setArea(e.target.value)} 
                      placeholder="e.g. South elevation" 
                      className="field-input"
                      data-testid="input-scan-area"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold">Inspector Note (Optional)</span>
                    <input 
                      value={inspectorNote} 
                      onChange={e => setInspectorNote(e.target.value)} 
                      placeholder="e.g. Moisture present" 
                      className="field-input"
                      data-testid="input-scan-note"
                    />
                  </label>
                </div>
                
                {error && <p className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
                
                <button 
                  onClick={handleAnalyze} 
                  disabled={mutation.isPending}
                  data-testid="button-analyze-image"
                  className="btn-primary mt-5 w-full justify-center py-3 text-base shadow-lg"
                >
                  <Sparkles size={18} /> Analyze with Vision AI
                </button>
              </div>
            )}
            
            {mutation.isPending && (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-card">
                <Loader2 size={32} className="animate-spin text-primary" />
                <p className="mt-4 text-sm font-medium">Analyzing condition...</p>
                <p className="mt-1 text-xs text-muted-foreground">Reviewing visible conditions and possible areas for inspector attention.</p>
              </div>
            )}
          </div>

          {analysis && (
            <div className="animate-rise-in space-y-5">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm shadow-sm">
                <p className="font-medium text-primary flex items-center gap-1.5"><Sparkles size={16} /> Analysis complete</p>
                <p className="mt-1.5 text-foreground/80 leading-relaxed">{analysis.summary}</p>
              </div>

              {analysis.findings.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">Potential conditions identified <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono">{analysis.findings.length}</span></h3>
                  {analysis.findings.map((finding, idx) => (
                    <div key={idx} className="rounded-lg border border-card-border bg-card p-5 shadow-sm transition hover:border-primary/40" data-testid={`card-scan-finding-${idx}`}>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={finding.suggestedSeverity} />
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{titleCase(finding.category)}</span>
                        <span className="ml-auto inline-flex items-center gap-1 rounded bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
                          {Math.round(finding.confidence * 100)}% Match
                        </span>
                      </div>
                      <h4 className="text-base font-semibold">{finding.label}</h4>
                      
                      <div className="mt-4 grid gap-4 text-xs md:grid-cols-2">
                        <div>
                          <div className="eyebrow">Observed</div>
                          <p className="mt-1.5 text-muted-foreground leading-relaxed">{finding.observation}</p>
                        </div>
                        <div>
                          <div className="eyebrow">Location Hint</div>
                          <p className="mt-1.5 text-muted-foreground leading-relaxed">{finding.locationHint}</p>
                        </div>
                      </div>
                      
                      <div className="mt-5 flex flex-col justify-between gap-4 border-t border-border/70 pt-4 sm:flex-row sm:items-center">
                        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 dark:bg-amber-500/15 p-2 rounded">
                          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                          <span className="leading-relaxed">{finding.limitation}</span>
                        </div>
                        <button 
                          onClick={() => acceptSuggestion(finding)}
                          data-testid={`button-accept-finding-${idx}`}
                          className="btn-primary shrink-0"
                        >
                          <Check size={16} /> Accept & Draft
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground shadow-sm">
                  <Check size={32} className="mx-auto text-primary/50" />
                  <p className="mt-3 text-sm font-medium text-foreground">No potential visible conditions identified</p>
                  <p className="mt-1 text-xs">The image analysis found no confident suggestions. Continue the normal inspection process.</p>
                </div>
              )}
              
              <div className="flex gap-2 rounded-md bg-muted/55 p-3 text-xs text-foreground/70">
                <Info size={15} className="mt-0.5 shrink-0 text-primary" />
                <span className="leading-relaxed">{analysis.disclaimer}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
