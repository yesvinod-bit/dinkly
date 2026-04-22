import React, { useState, useEffect } from 'react';
import { ShieldAlert, Lock, ChevronRight, AlertTriangle, Key } from 'lucide-react';
import { motion } from 'motion/react';
import { validateInviteCode, claimInviteCode } from '../lib/membershipService';
import { User } from 'firebase/auth';

interface Props {
  onVerify: () => void;
  user: User;
}

export default function Gatekeeper({ onVerify, user }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const playerName = user.displayName || (user.isAnonymous ? 'Guest Player' : 'Player');

  useEffect(() => {
    // Auto-check URL for invite code
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) {
      handleVerify(code);
    }
  }, []);

  const handleVerify = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const invite = await validateInviteCode(code);
      if (invite) {
        await claimInviteCode(user.uid, user.email || '', playerName, invite);
        onVerify();
        // Clean URL
        window.history.replaceState({}, document.title, "/");
      } else {
        setError('Invalid or full invite code');
      }
    } catch (e) {
      setError('System verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    handleVerify(input);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full"
      >
        <div className="bg-white border-4 border-slate-800 rounded-[2rem] p-8 shadow-[12px_12px_0px_0px_rgba(163,230,53,1)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-yellow-400 repeating-linear-gradient-caution" />
          
          <div className="text-center relative z-10">
            <motion.div 
              animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
              className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 border-4 border-slate-800 rotate-3 transition-colors ${
                error ? 'bg-orange-500 text-white' : 'bg-lime-400 '
              }`}
            >
              {loading ? (
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-800"></div>
              ) : error ? (
                <ShieldAlert className="w-10 h-10" />
              ) : (
                <Key className="w-10 h-10 text-slate-900" />
              )}
            </motion.div>

            <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2 uppercase italic">
              {loading ? 'Entering Court...' : 'Access Gate'}
            </h2>
            <p className="text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em] mb-8">
              {loading ? 'One-Click Join in progress' : 'Invitation Required'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <input 
                  type="text"
                  disabled={loading}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="INVITE CODE"
                  className={`w-full brutal-input text-center text-xl tracking-[0.3em] font-mono uppercase bg-slate-50 ${
                    error ? 'border-orange-500 ring-orange-100 ring-4' : 'border-slate-800'
                  }`}
                  autoFocus
                />
              </div>

              {error && (
                <motion.p 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-orange-500 text-[10px] font-black uppercase tracking-widest"
                >
                  {error}
                </motion.p>
              )}

              <button 
                type="submit"
                disabled={loading}
                className="w-full brutal-button-orange py-4 text-lg flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {loading ? 'VERIFYING...' : 'UNLOCK ACCESS'}
                <ChevronRight className="w-5 h-5" />
              </button>
            </form>

            <div className="mt-8 flex items-start gap-3 text-left bg-slate-50 p-4 rounded-2xl border-2 border-slate-200">
              <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase">
                Welcome, {playerName}! This court is currently private. Please enter a valid invite code or use an invitation link to start mixing.
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      <style dangerouslySetInnerHTML={{ __html: `
        .repeating-linear-gradient-caution {
          background: repeating-linear-gradient(
            45deg,
            #facc15,
            #facc15 10px,
            #1e293b 10px,
            #1e293b 20px
          );
        }
      `}} />
    </div>
  );
}
