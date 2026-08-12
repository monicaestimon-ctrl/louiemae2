import React, { useState, useEffect } from 'react';
import { X, Wand2, Send, ChevronRight, Layout, Type, Image as ImageIcon, CheckCircle, Clock, AlertCircle, ArrowLeft, Eye, Smartphone, Monitor, Loader2, Grid } from 'lucide-react';
import { EmailCampaign } from '../types';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { EMAIL_TEMPLATES, EmailTemplate } from '../constants/emailTemplates';
import { FadeIn } from './FadeIn';

interface NewsletterStudioProps {
    isOpen: boolean;
    onClose: () => void;
    initialCampaign?: Partial<EmailCampaign> | null;
    onSave: (campaign: Partial<EmailCampaign>) => void;
}

type StudioStep = 'strategy' | 'templates' | 'design' | 'launch';

export const NewsletterStudio: React.FC<NewsletterStudioProps> = ({ isOpen, onClose, initialCampaign, onSave }) => {
    const [step, setStep] = useState<StudioStep>('strategy');
    const [campaign, setCampaign] = useState<Partial<EmailCampaign>>({
        subject: '',
        previewText: '',
        content: '',
        status: 'draft',
        type: 'newsletter',
        ...initialCampaign
    });

    // Reset when opening with new campaign
    useEffect(() => {
        if (isOpen && initialCampaign) {
            setCampaign({
                subject: '',
                previewText: '',
                content: '',
                status: 'draft',
                type: 'newsletter',
                ...initialCampaign
            });
            setStep('strategy');
        }
    }, [isOpen, initialCampaign]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[500] bg-black/40 backdrop-blur-sm flex items-center justify-center p-0 md:p-6 animate-fade-in">
            {/* Centered Modal Container */}
            <div className="bg-[#FAFAF9] w-full h-full md:h-auto md:max-w-5xl md:max-h-[90vh] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden relative border border-white/10 animate-fade-in-up">

                {/* Top Bar: Navigation & Progress */}
                <div className="shrink-0 h-auto py-3 md:h-16 border-b border-earth/10 flex flex-col md:flex-row items-start md:items-center justify-between px-3 md:px-6 gap-2 md:gap-0 bg-white/50 backdrop-blur-sm z-20">
                    <div className="flex items-center gap-4">
                        <button onClick={onClose} className="p-2 hover:bg-earth/5 rounded-full transition-colors">
                            <X className="w-5 h-5 text-earth/60" />
                        </button>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-widest text-earth/40">Newsletter Studio</span>
                            <h1 className="font-serif text-xl text-earth">
                                {campaign.subject || 'Untitled Campaign'}
                            </h1>
                        </div>
                    </div>

                    {/* Step Indicator */}
                    <div className="md:absolute md:left-1/2 md:-translate-x-1/2 w-full md:w-auto flex justify-center">
                        <StudioStepIndicator currentStep={step} />
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-xs text-earth/40 hidden sm:block">
                            {campaign.status === 'draft' ? 'Draft Saved' : 'Unsaved'}
                        </span>
                        <button onClick={() => onSave(campaign)} className="text-sm font-medium text-earth/60 hover:text-earth px-4 py-2 hover:bg-earth/5 rounded-md transition-colors">
                            Save & Close
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto relative bg-[#FAFAF9]">

                    {step === 'strategy' && (
                        <StrategyStep
                            campaign={campaign}
                            onChange={setCampaign}
                            onNext={() => setStep('templates')}
                        />
                    )}

                    {step === 'templates' && (
                        <TemplateStep
                            campaign={campaign}
                            onChange={setCampaign}
                            onBack={() => setStep('strategy')}
                            onNext={() => setStep('design')}
                        />
                    )}

                    {step === 'design' && (
                        <DesignStep
                            campaign={campaign}
                            onChange={setCampaign}
                            onBack={() => setStep('templates')}
                            onNext={() => setStep('launch')}
                        />
                    )}

                    {step === 'launch' && (
                        <LaunchStep
                            campaign={campaign}
                            onChange={setCampaign}
                            onBack={() => setStep('design')}
                            onLaunch={() => onSave({ ...campaign, status: 'sent' })}
                        />
                    )}

                </div>
            </div>
        </div>
    );
};

// --- Sub-Components ---

const StudioStepIndicator: React.FC<{ currentStep: StudioStep }> = ({ currentStep }) => {
    const steps: { id: StudioStep; label: string; icon: any }[] = [
        { id: 'strategy', label: 'Strategy', icon: Wand2 },
        { id: 'templates', label: 'Templates', icon: Grid },
        { id: 'design', label: 'Design', icon: Layout },
        { id: 'launch', label: 'Launch', icon: Send },
    ];

    const stepOrder = ['strategy', 'templates', 'design', 'launch'];
    const currentIndex = stepOrder.indexOf(currentStep);

    return (
        <div className="flex items-center bg-earth/5 rounded-full p-1">
            {steps.map((s, index) => {
                const isActive = s.id === currentStep;
                const isCompleted = index < currentIndex;

                return (
                    <div
                        key={s.id}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 ${isActive ? 'bg-white shadow-sm text-earth' : 'text-earth/40'
                            }`}
                    >
                        <s.icon className={`w-4 h-4 ${isActive ? 'text-bronze' : ''}`} />
                        <span className={`text-xs font-medium tracking-wide ${isActive ? 'block' : 'hidden md:block'}`}>
                            {s.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

const StrategyStep: React.FC<{ campaign: Partial<EmailCampaign>, onChange: (c: any) => void, onNext: () => void }> = ({ campaign, onChange, onNext }) => {
    const generateEmailSubject = useAction(api.ai.generateEmailSubject);
    const [isGenerating, setIsGenerating] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);

    const handleGenerateSubjects = async () => {
        if (!campaign.subject) return;
        setIsGenerating(true);
        const results = await generateEmailSubject({ topic: campaign.subject });
        setSuggestions(results);
        setIsGenerating(false);
    };

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="p-6 lg:p-10 animate-fade-in-up">
                <div className="w-full max-w-5xl mx-auto space-y-6">
                    <div className="text-center space-y-1">
                        <h2 className="font-serif text-3xl text-earth">Campaign Strategy</h2>
                        <p className="text-earth/60 font-light text-lg">Let's define the intent behind this message.</p>
                    </div>

                    <div className="bg-white p-8 rounded-xl shadow-sm border border-earth/5 space-y-8">
                        <div>
                            <label className="block text-xs uppercase tracking-widest text-earth/40 mb-3">Campaign Objective</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {['Newsletter', 'Promotion', 'Update'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => onChange({ ...campaign, type: type.toLowerCase() })}
                                        className={`p-4 rounded-lg border text-left transition-all ${campaign.type === type.toLowerCase()
                                            ? 'border-bronze bg-bronze/5 ring-1 ring-bronze/20'
                                            : 'border-earth/10 hover:border-earth/30 hover:bg-earth/5'
                                            }`}
                                    >
                                        <span className="block font-medium text-earth">{type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-xs uppercase tracking-widest text-earth/40">Topic / Theme</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="e.g. Spring Collection Launch"
                                    className="w-full text-2xl font-serif border-b border-earth/10 py-2 pr-12 focus:outline-none focus:border-bronze bg-transparent placeholder:text-earth/20"
                                    value={campaign.subject || ''}
                                    onChange={(e) => onChange({ ...campaign, subject: e.target.value })}
                                />
                                <button
                                    onClick={handleGenerateSubjects}
                                    disabled={!campaign.subject || isGenerating}
                                    className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-bronze hover:bg-bronze/10 rounded-full transition-colors disabled:opacity-30"
                                    title="Generate Smart Suggestions"
                                >
                                    {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                                </button>
                            </div>

                            {suggestions.length > 0 && (
                                <div className="animate-fade-in space-y-2">
                                    <p className="text-xs text-earth/40 uppercase tracking-widest">Smart Suggestions</p>
                                    <div className="grid gap-2">
                                        {suggestions.map((s, i) => (
                                            <button
                                                key={i}
                                                onClick={() => onChange({ ...campaign, subject: s })}
                                                className="text-left p-3 hover:bg-earth/5 rounded-md text-earth/80 hover:text-earth transition-colors text-sm font-serif"
                                            >
                                                "{s}"
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <button onClick={onNext} disabled={!campaign.subject} className="w-full py-4 bg-earth text-white rounded-lg hover:bg-earth/90 transition-colors flex items-center justify-center gap-2 text-lg font-light tracking-wide shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
                        Next: Choose Template <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

const TemplateStep: React.FC<{ campaign: Partial<EmailCampaign>, onChange: (c: any) => void, onBack: () => void, onNext: () => void }> = ({ campaign, onChange, onBack, onNext }) => {
    const personalizeTemplate = useAction(api.ai.personalizeTemplate);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [isPersonalizing, setIsPersonalizing] = useState(false);

    const handleSelectTemplate = async (templateId: string) => {
        setSelectedTemplate(templateId);
        setIsPersonalizing(true);

        // Find template base content
        const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
        if (!template) return;

        let finalContent = template.baseContent;

        // Smart fill with AI
        if (campaign.subject) {
            const aiContent = await personalizeTemplate({
                templateId,
                topic: campaign.subject,
                objective: campaign.type || 'newsletter',
            });

            // simple find and replace for placeholders
            Object.keys(aiContent).forEach(key => {
                finalContent = finalContent.replace(new RegExp(`{{${key}}}`, 'g'), aiContent[key]);
            });
        }

        // Clean up any remaining placeholders
        finalContent = finalContent.replace(/{{\w+}}/g, '');

        onChange({ ...campaign, content: finalContent });
        setIsPersonalizing(false);
    };

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="p-6 lg:p-10 animate-fade-in-up">
                <div className="w-full space-y-6">
                    <div className="flex items-center gap-2 mb-8">
                        <button onClick={onBack} className="text-earth/40 hover:text-earth"><ArrowLeft className="w-5 h-5" /></button>
                        <div className="text-center flex-1">
                            <h2 className="font-serif text-3xl text-earth">Select a Template</h2>
                            <p className="text-earth/60 font-light">We'll personalize it for your campaign.</p>
                        </div>
                        <div className="w-5"></div> {/* spacer */}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {EMAIL_TEMPLATES.map(template => (
                            <button
                                key={template.id}
                                onClick={() => handleSelectTemplate(template.id)}
                                disabled={isPersonalizing}
                                className={`group relative flex flex-col items-start text-left bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border ${selectedTemplate === template.id ? 'border-bronze ring-2 ring-bronze/20' : 'border-earth/10 hover:border-bronze/50'}`}
                            >
                                {/* Visual HTML Preview */}
                                <div className="w-full aspect-[3/4] relative overflow-hidden bg-white border-b border-earth/5">
                                    <div
                                        className="absolute top-0 left-0 origin-top-left"
                                        style={{ transform: 'scale(0.35)', width: '286%', height: '286%' }}
                                    >
                                        <div dangerouslySetInnerHTML={{ __html: template.baseContent }} />
                                    </div>
                                    <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className="bg-earth text-white px-5 py-2.5 rounded-full text-xs uppercase tracking-widest shadow-lg">Use Template</span>
                                    </div>
                                </div>
                                <div className="p-5 w-full">
                                    <h3 className="font-serif text-xl text-earth mb-1">{template.name}</h3>
                                    <p className="text-sm text-earth/60 font-light leading-relaxed">{template.description}</p>
                                </div>
                                {selectedTemplate === template.id && isPersonalizing && (
                                    <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-10">
                                        <div className="flex flex-col items-center gap-3">
                                            <Loader2 className="w-8 h-8 text-bronze animate-spin" />
                                            <span className="text-sm uppercase tracking-widest text-bronze font-medium">Personalizing...</span>
                                        </div>
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>

                    {selectedTemplate && !isPersonalizing && (
                        <div className="flex justify-center pt-8 animate-fade-in">
                            <button onClick={onNext} className="py-4 px-12 bg-earth text-white rounded-lg hover:bg-earth/90 transition-colors flex items-center gap-2 text-lg font-light tracking-wide shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 duration-200">
                                Customize Design <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const DesignStep: React.FC<{ campaign: Partial<EmailCampaign>, onChange: (c: any) => void, onBack: () => void, onNext: () => void }> = ({ campaign, onChange, onBack, onNext }) => {
    const [zenMode, setZenMode] = useState(false);
    const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile');

    const insertContent = (text: string) => {
        onChange({ ...campaign, content: (campaign.content || '') + text });
    };

    return (
        <div className={`h-full flex flex-col md:flex-row animate-fade-in transition-all duration-500 ${zenMode ? 'bg-[#FAFAF9]' : ''}`}>
            {/* Editor */}
            <div className={`${zenMode ? 'w-full max-w-3xl mx-auto' : 'w-full md:w-1/2 border-b md:border-b-0 md:border-r border-earth/10'} md:h-full overflow-y-auto transition-all duration-500 custom-scrollbar`}>
                <div className={`p-4 md:p-12 space-y-8 ${zenMode ? 'py-12' : ''}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button onClick={onBack} className="text-earth/40 hover:text-earth"><ArrowLeft className="w-5 h-5" /></button>
                            <h2 className="font-serif text-3xl text-earth">Content Design</h2>
                        </div>
                        <button
                            onClick={() => setZenMode(!zenMode)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${zenMode ? 'bg-bronze text-white' : 'bg-earth/5 text-earth/60 hover:text-earth'}`}
                        >
                            <Layout className="w-3 h-3" /> {zenMode ? 'Exit Zen Mode' : 'Zen Mode'}
                        </button>
                    </div>

                    {/* Smart Blocks Toolbar */}
                    <div className="flex gap-2 p-2 bg-white border border-earth/10 rounded-lg shadow-sm overflow-x-auto no-scrollbar">
                        <button onClick={() => insertContent('\n<blockquote>"Your quote here"</blockquote>\n')} className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-earth/5 rounded text-xs text-earth/60 whitespace-nowrap">
                            <Type className="w-3 h-3" /> Quote
                        </button>
                        <button onClick={() => insertContent('\n<div style="text-align:center; margin: 20px 0;"><a href="#" style="background:#5D5C56; color:white; padding:12px 24px; text-decoration:none;">Shop Now</a></div>\n')} className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-earth/5 rounded text-xs text-earth/60 whitespace-nowrap">
                            <CheckCircle className="w-3 h-3" /> Button
                        </button>
                        <button onClick={() => insertContent('\n<img src="https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=800" style="width:100%; border-radius: 4px; margin: 20px 0;" />\n')} className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-earth/5 rounded text-xs text-earth/60 whitespace-nowrap">
                            <ImageIcon className="w-3 h-3" /> Image
                        </button>
                        <div className="w-px bg-earth/10 mx-1"></div>
                        <button onClick={() => onChange({ ...campaign, content: '<h2>New Collection Launch</h2><p>We are thrilled to announce...</p>' })} className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-earth/5 rounded text-xs text-earth/60 whitespace-nowrap">
                            <Wand2 className="w-3 h-3" /> Quick Fill
                        </button>
                    </div>

                    <div className="space-y-4">
                        <textarea
                            className="w-full min-h-[500px] p-8 bg-white border border-earth/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-bronze/20 font-serif text-lg leading-relaxed resize-none shadow-sm"
                            placeholder="Start writing your story..."
                            value={campaign.content || ''}
                            onChange={(e) => onChange({ ...campaign, content: e.target.value })}
                        />
                    </div>
                </div>
            </div>

            {/* Preview - Hidden in Zen Mode */}
            <div className={`${zenMode ? 'w-0 opacity-0 overflow-hidden p-0' : 'hidden md:flex w-full md:w-1/2 p-6 md:p-12 opacity-100'} bg-earth/5 flex-col items-center justify-center relative transition-all duration-500 overflow-hidden md:h-full`}>
                <div className="absolute top-6 right-6 flex gap-2 bg-white/50 backdrop-blur-sm p-1 rounded-lg z-10">
                    <button
                        onClick={() => setPreviewDevice('mobile')}
                        className={`p-2 rounded-md transition-colors ${previewDevice === 'mobile' ? 'bg-white shadow-sm text-earth' : 'text-earth/60 hover:bg-white/50'}`}
                    >
                        <Smartphone className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setPreviewDevice('desktop')}
                        className={`p-2 rounded-md transition-colors ${previewDevice === 'desktop' ? 'bg-white shadow-sm text-earth' : 'text-earth/60 hover:bg-white/50'}`}
                    >
                        <Monitor className="w-4 h-4" />
                    </button>
                </div>

                <div
                    className={`bg-white shadow-2xl rounded-sm overflow-hidden flex flex-col transition-all duration-500 ${previewDevice === 'mobile' ? 'w-[375px] h-[700px] border-[8px] border-gray-800 rounded-[20px] mb-12' : 'w-full max-w-xl h-[80vh]'
                        }`}
                >
                    <div className="p-8 border-b border-earth/5 text-center bg-white sticky top-0 z-10 shrink-0">
                        <h3 className="font-serif text-xl text-earth">Louie Mae</h3>
                    </div>
                    <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                        <h1 className="font-serif text-2xl mb-4">{campaign.subject}</h1>
                        <div className="prose prose-stone prose-sm font-serif max-w-none" dangerouslySetInnerHTML={{ __html: campaign.content || '' }} />
                    </div>
                </div>

                <div className="absolute bottom-8 right-8 z-20">
                    <button onClick={onNext} className="py-3 px-8 bg-earth text-white rounded-lg hover:bg-earth/90 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 duration-200">
                        Final Review <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

const LaunchStep: React.FC<{ campaign: Partial<EmailCampaign>, onChange: (c: any) => void, onBack: () => void, onLaunch: () => void }> = ({ campaign, onChange, onBack, onLaunch }) => {
    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#FAFAF9]">
            <div className="min-h-full flex flex-col items-center justify-center p-8 animate-fade-in-up">
                <div className="max-w-2xl w-full space-y-8 my-8">
                    <div className="text-center space-y-2">
                        <h2 className="font-serif text-4xl text-earth">Ready to Launch</h2>
                        <p className="text-earth/60 font-light text-lg">Review your campaign before sending.</p>
                    </div>

                    <div className="bg-white p-8 rounded-xl shadow-sm border border-earth/5 space-y-6">
                        <div className="flex items-center gap-4 p-4 bg-green-50/50 border border-green-100 rounded-lg">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                            <div>
                                <h4 className="font-medium text-green-900">System Check Passed</h4>
                                <p className="text-sm text-green-700">No spam triggers detected. Links are valid.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 py-4">
                            <div>
                                <span className="block text-xs uppercase tracking-widest text-earth/40 mb-1">Subject</span>
                                <p className="font-serif text-xl">{campaign.subject}</p>
                            </div>
                            <div>
                                <span className="block text-xs uppercase tracking-widest text-earth/40 mb-1">Recipients</span>
                                <p className="font-serif text-xl">All Subscribers (2,590)</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <button onClick={onBack} className="w-1/3 py-4 border border-earth/10 text-earth/60 rounded-lg hover:bg-earth/5 transition-colors">
                            Back to Design
                        </button>
                        <button onClick={onLaunch} className="w-2/3 py-4 bg-bronze text-white rounded-lg hover:bg-bronze/90 transition-colors flex items-center justify-center gap-2 text-lg font-light tracking-wide shadow-lg hover:shadow-xl">
                            <Send className="w-5 h-5" /> Launch Campaign
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
