import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  setDoc, 
  deleteDoc,
  serverTimestamp, 
  arrayUnion, 
  increment,
  addDoc,
  orderBy,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';

export interface Membership {
  email: string;
  displayName: string;
  inviteCodeId: string;
  status: 'active' | 'deactivated';
  joinedAt: any;
}

export interface InviteCode {
  id: string;
  code: string;
  maxUses: number;
  currentUses: number;
  claimedBy: string[];
  createdAt: any;
}

export const checkMembership = async (uid: string): Promise<Membership | null> => {
  const docRef = doc(db, 'memberships', uid);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data() as Membership;
  }
  return null;
};

export const validateInviteCode = async (code: string): Promise<InviteCode | null> => {
  const q = query(collection(db, 'inviteCodes'), where('code', '==', code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  
  const data = snap.docs[0].data();
  if (data.currentUses < data.maxUses) {
    return { id: snap.docs[0].id, ...data } as InviteCode;
  }
  return null;
};

export const claimInviteCode = async (uid: string, email: string, displayName: string, invite: InviteCode) => {
  const inviteRef = doc(db, 'inviteCodes', invite.id);
  const membershipRef = doc(db, 'memberships', uid);
  const batch = writeBatch(db);

  batch.update(inviteRef, {
    currentUses: increment(1),
    claimedBy: arrayUnion(uid)
  });

  batch.set(membershipRef, {
    email,
    displayName,
    inviteCodeId: invite.id,
    status: 'active',
    joinedAt: serverTimestamp()
  });

  await batch.commit();
};

export const generateInviteCode = async (maxUses: number = 10) => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await addDoc(collection(db, 'inviteCodes'), {
    code,
    maxUses,
    currentUses: 0,
    claimedBy: [],
    createdAt: serverTimestamp()
  });
  return code;
};

export const getAllInviteCodes = async () => {
  const q = query(collection(db, 'inviteCodes'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as InviteCode));
};

export const getAllMemberships = async () => {
  const q = query(collection(db, 'memberships'), orderBy('joinedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Membership & { id: string }));
};

export const toggleMembershipStatus = async (uid: string, currentStatus: string) => {
  const membershipRef = doc(db, 'memberships', uid);
  await updateDoc(membershipRef, {
    status: currentStatus === 'active' ? 'deactivated' : 'active'
  });
};

export const deleteInviteCode = async (inviteCodeId: string) => {
  await deleteDoc(doc(db, 'inviteCodes', inviteCodeId));
};

export const cleanupInviteCodes = async () => {
  const codes = await getAllInviteCodes();
  const exhaustedCodes = codes.filter((code) => code.currentUses >= code.maxUses);

  if (exhaustedCodes.length === 0) {
    return 0;
  }

  const batch = writeBatch(db);
  exhaustedCodes.forEach((code) => {
    batch.delete(doc(db, 'inviteCodes', code.id));
  });
  await batch.commit();

  return exhaustedCodes.length;
};
