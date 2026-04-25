import React, { useState, useEffect } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp
} from 'firebase/firestore';
import { 
  generateInviteCode, 
  getAllInviteCodes, 
  getAllMemberships, 
  toggleMembershipStatus,
  deleteInviteCode,
  cleanupInviteCodes,
  InviteCode,
  Membership
} from '../lib/membershipService';
import { db } from '../lib/firebase';
import { 
  ShieldCheck, 
  UserPlus, 
  Users, 
  Key, 
  ShieldOff, 
  Copy, 
  CheckCircle2, 
  Clock,
  Link as LinkIcon,
  MessageSquare,
  Trash2,
  Eraser,
  Mail,
  UserRound
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  onBack: () => void;
}

interface LoginRecord {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  loginMethod?: 'google' | 'anonymous' | 'unknown';
  providerId?: string;
  isAnonymous?: boolean;
  timestamp?: Timestamp;
}

interface LoginSummary {
  key: string;
  displayName: string;
  email: string;
  loginBadge: string;
  recentTimes: Timestamp[];
}

export default function AdminPanel({ onBack }: Props) {
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [memberships, setMemberships] = useState<(Membership & { id: string })[]>([]);
  const [recentLogins, setRecentLogins] = useState<LoginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [codes, members, logins] = await Promise.all([
        getAllInviteCodes(),
        getAllMemberships(),
        getRecentLogins()
      ]);
      setInviteCodes(codes);
      setMemberships(members);
      setRecentLogins(logins);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getRecentLogins = async (): Promise<LoginRecord[]> => {
    const loginsQuery = query(
      collection(db, 'logins'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const snap = await getDocs(loginsQuery);
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as LoginRecord));
  };

  const formatLoginTime = (timestamp?: Timestamp) => {
    if (!timestamp) return 'Pending...';
    return timestamp.toDate().toLocaleString();
  };

  const getLoginBadge = (login: LoginRecord) => {
    if (login.loginMethod === 'google') return 'Google';
    if (login.loginMethod === 'anonymous') return 'Guest';
    if (login.isAnonymous) return 'Guest';
    if (login.email) return 'Google';
    return login.providerId || 'Unknown';
  };

  const isGoogleLogin = (login: LoginRecord) => getLoginBadge(login) === 'Google';

  const groupedRecentLogins: LoginSummary[] = recentLogins.reduce<LoginSummary[]>((groups, login) => {
    const groupKey = (login.email || login.uid || login.id).trim().toLowerCase();
    const existingGroup = groups.find((group) => group.key === groupKey);
    const loginBadge = getLoginBadge(login);

    if (existingGroup) {
      if (login.timestamp && existingGroup.recentTimes.length < 2) {
        existingGroup.recentTimes.push(login.timestamp);
      }
      return groups;
    }

    groups.push({
      key: groupKey,
      displayName: login.displayName || 'Unknown Player',
      email: login.email || 'anonymous@guest',
      loginBadge,
      recentTimes: login.timestamp ? [login.timestamp] : []
    });

    return groups;
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const code = await generateInviteCode(10);
      await loadData();
      alert(`Success! Generated code: ${code}`);
    } catch (e) {
      console.error(e);
      alert('Failed to generate code. Error: ' + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggle = async (uid: string, status: string) => {
    await toggleMembershipStatus(uid, status);
    loadData();
  };

  const handleDeleteInvite = async (invite: InviteCode) => {
    setDeletingId(invite.id);
    try {
      await deleteInviteCode(invite.id);
      await loadData();
    } catch (e) {
      console.error(e);
      alert('Failed to delete invite code. Error: ' + (e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanupInviteCodes = async () => {
    setCleaning(true);
    try {
      const removedCount = await cleanupInviteCodes();
      await loadData();
      alert(removedCount > 0 ? `Cleaned up ${removedCount} used-up invite code(s).` : 'No used-up invite codes to clean up.');
    } catch (e) {
      console.error(e);
      alert('Failed to clean up invite codes. Error: ' + (e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const handleInvite = async (code: string, mode: 'share' | 'copy' = 'share') => {
    // FORCE PUBLIC DOMAIN (ais-pre)
    // We aggressively swap 'ais-dev' for 'ais-pre' because 'ais-dev' is 
    // private to the developer and triggers the 403 forbidden bridge.
    let currentUrl = window.location.href.split('?')[0]; // Current page minus params
    
    // Attempt standard swap
    let baseUrl = currentUrl.replace('ais-dev-', 'ais-pre-');
    
    // Ensure we don't have trailing slash issues causing double slashes
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const url = `${baseUrl}?invite=${code}`;
    const shareTitle = '🏓 Court\'s Open! You\'re Invited to Dinkly!';
    const shareText = `Hey! I've added you to our private Pickleball circle. Use this app to manage tournaments and track live scores! 🥂\n\nJoin here: ${url} 🔥`;

    if (mode === 'share' && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: url
        });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          navigator.clipboard.writeText(shareText);
          setCopiedId(code + '_msg');
          setTimeout(() => setCopiedId(null), 2000);
        }
      }
    } else {
      navigator.clipboard.writeText(shareText);
      setCopiedId(code + '_msg');
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Header with Navigation */}
      <div className="flex flex-col gap-4 bg-slate-800 p-4 rounded-3xl border-4 border-slate-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-lime-400 border-2 border-slate-900 rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-slate-900" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-white uppercase leading-none">Security Center</h2>
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Admin Operations</p>
          </div>
        </div>
        <button 
          onClick={onBack}
          className="w-full px-4 py-2 bg-white border-2 border-slate-900 rounded-xl font-black text-[10px] uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all sm:w-auto"
        >
          Close Panel
        </button>
      </div>

      {/* Invite Code Generator */}
      <section className="bg-white border-4 border-slate-800 rounded-[2rem] p-6 shadow-[8px_8px_0px_0px_rgba(163,230,53,1)]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-orange-100 border-2 border-slate-800 rounded-xl flex items-center justify-center">
              <Key className="w-5 h-5 text-orange-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-slate-800 uppercase italic">Invite Codes</h2>
              <p className="mt-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-tight text-emerald-500 break-all">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                Sharing from: {window.location.origin.includes('ais-dev-') ? window.location.origin.replace('ais-dev-', 'ais-pre-') : window.location.origin}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button 
              onClick={handleCleanupInviteCodes}
              disabled={cleaning}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none disabled:opacity-50 sm:w-auto"
            >
              {cleaning ? (
                <div className="w-4 h-4 border-2 border-slate-800 border-t-transparent animate-spin rounded-full" />
              ) : (
                <Eraser className="w-4 h-4" />
              )}
              {cleaning ? 'CLEANING...' : 'CLEAN USED UP'}
            </button>
            <button 
              onClick={handleGenerate}
              disabled={generating}
              className="brutal-button-orange flex w-full items-center justify-center gap-2 text-xs disabled:opacity-50 sm:w-auto"
            >
              {generating ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {generating ? 'GENERATING...' : 'GENERATE NEW'}
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {inviteCodes.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-4 p-4 bg-slate-50 border-2 border-slate-800 rounded-2xl group xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-mono font-black text-lg text-slate-800 tracking-wider">
                  {invite.code}
                </span>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-white border-2 border-slate-200 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">
                    {invite.currentUses} / {invite.maxUses} CLAIMED
                  </span>
                </div>
              </div>
                <div className="flex min-w-0 flex-col gap-3 xl:max-w-[32rem]">
                  <div className="bg-slate-50 border-2 border-slate-200 p-2 rounded-xl">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter mb-1">Friends must use this URL:</p>
                    <code className="flex flex-col gap-2 rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-mono font-bold text-emerald-600 sm:flex-row sm:items-start sm:justify-between">
                      <span className="break-all">{window.location.origin.replace('ais-dev-', 'ais-pre-')}?invite={invite.code}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin.replace('ais-dev-', 'ais-pre-')}?invite=${invite.code}`);
                          setCopiedId(invite.code + '_link');
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                        className="self-start bg-emerald-500 text-white p-1 rounded-lg hover:bg-emerald-600 sm:ml-2"
                      >
                        {copiedId === invite.code + '_link' ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </code>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button 
                      onClick={() => handleInvite(invite.code, 'share')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-800 bg-white p-2 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none sm:flex-1"
                      title="Share via Native Menu"
                    >
                      <LinkIcon className="w-4 h-4 text-slate-800" />
                      <span className="text-[10px] font-black uppercase">Share with Friends</span>
                    </button>

                    <button 
                      onClick={() => handleInvite(invite.code, 'copy')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-800 bg-lime-400 p-2 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none sm:w-auto"
                      title="Copy WhatsApp Formatting"
                    >
                      {copiedId === invite.code + '_msg' ? (
                        <CheckCircle2 className="w-4 h-4 text-slate-900" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-slate-900" />
                      )}
                      <span className="text-[10px] font-black uppercase text-slate-900">
                        {copiedId === invite.code + '_msg' ? 'Copied!' : 'Copy Msg'}
                      </span>
                    </button>

                    <button 
                      onClick={() => handleDeleteInvite(invite)}
                      disabled={deletingId === invite.id}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-800 bg-orange-100 p-2 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none disabled:opacity-50 sm:w-auto"
                      title="Delete Invite Code"
                    >
                      {deletingId === invite.id ? (
                        <div className="w-4 h-4 border-2 border-slate-800 border-t-transparent animate-spin rounded-full" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-slate-900" />
                      )}
                    </button>
                  </div>
                </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border-4 border-slate-800 rounded-[2rem] p-6 shadow-[8px_8px_0px_0px_rgba(59,130,246,1)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-sky-100 border-2 border-slate-800 rounded-xl flex items-center justify-center">
            <Mail className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase italic">Recent Logins</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Gmail and guest sign-ins
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {groupedRecentLogins.length === 0 ? (
            <div className="p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl text-[11px] font-black text-slate-500 uppercase tracking-wide">
              No login activity yet.
            </div>
          ) : (
            groupedRecentLogins.map((login) => (
              <div key={login.key} className="flex flex-col gap-3 p-4 bg-slate-50 border-2 border-slate-800 rounded-2xl sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl border-2 border-slate-800 flex items-center justify-center shrink-0 ${
                    login.loginBadge === 'Google' ? 'bg-sky-100' : 'bg-lime-100'
                  }`}>
                    {login.loginBadge === 'Google' ? (
                      <Mail className="w-5 h-5 text-sky-700" />
                    ) : (
                      <UserRound className="w-5 h-5 text-lime-700" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-slate-800 text-sm uppercase truncate">{login.displayName}</p>
                    <p className="text-[10px] text-slate-500 font-mono tracking-tight truncate">
                      {login.email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:items-end shrink-0">
                  <span className={`inline-flex px-2 py-1 rounded-md text-[9px] font-black uppercase border-2 ${
                    login.loginBadge === 'Google'
                      ? 'bg-sky-50 border-sky-500 text-sky-700'
                      : 'bg-lime-50 border-lime-500 text-lime-700'
                  }`}>
                    {login.loginBadge}
                  </span>
                  <div className="flex flex-col gap-1 text-left sm:text-right">
                    {login.recentTimes.map((timestamp, index) => (
                      <p key={`${login.key}-${index}`} className="text-[10px] text-slate-400 font-bold whitespace-nowrap">
                        {index === 0 ? 'Latest:' : 'Previous:'} {formatLoginTime(timestamp)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* User Management */}
      <section className="bg-white border-4 border-slate-800 rounded-[2rem] p-6 shadow-[8px_8px_0px_0px_rgba(249,115,22,1)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-lime-100 border-2 border-slate-800 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-lime-600" />
          </div>
          <h2 className="text-xl font-black text-slate-800 uppercase italic">Access Management</h2>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-slate-100">
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Player</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y border-slate-50">
              {memberships.map((member) => (
                <tr key={member.id} className="group">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center border-2 border-slate-800 font-black text-xs">
                        {member.displayName.charAt(0)}
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-sm uppercase">{member.displayName}</p>
                        <p className="text-[10px] text-slate-400 font-mono tracking-tight">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-center">
                    <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase border-2 ${
                      member.status === 'active' 
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-600' 
                        : 'bg-orange-50 border-orange-500 text-orange-600'
                    }`}>
                      {member.status}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <button 
                      onClick={() => handleToggle(member.id, member.status)}
                      className={`p-2 rounded-xl border-2 border-slate-800 transition-all ${
                        member.status === 'active'
                          ? 'bg-orange-500 text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none'
                          : 'bg-emerald-500 text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none'
                      }`}
                    >
                      {member.status === 'active' ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center justify-center gap-2 bg-slate-900 p-4 rounded-3xl border-4 border-slate-800">
        <Clock className="w-4 h-4 text-lime-400" />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Last sync: {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
