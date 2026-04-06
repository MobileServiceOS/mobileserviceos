// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

const AUTH_ERRORS = {
  'auth/user-not-found':        'No account found with that email.',
  'auth/wrong-password':        'Incorrect password.',
  'auth/invalid-credential':    'Incorrect email or password.',
  'auth/too-many-requests':     'Too many attempts. Try again later.',
  'auth/network-request-failed':'Network error. Check your connection.',
  'auth/popup-closed-by-user':  'Google sign-in was cancelled.',
};

function AuthShell({ title, subtitle, children }) {
  return (
    <div style={{ minHeight:'100dvh', background:'#111', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px 20px' }}>
      {/* Logo / Brand */}
      <div style={{ marginBottom:32, textAlign:'center' }}>
        <div style={{ width:64, height:64, background:COLORS.primary, borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center', fontSize:32, margin:'0 auto 16px' }}>🛞</div>
        <div style={{ fontSize:24, fontWeight:800, color:'#fff', letterSpacing:'-0.5px' }}>Mobile Service OS</div>
        <div style={{ fontSize:13, color:'#555', marginTop:4 }}>The operating system for mobile service businesses</div>
      </div>

      {/* Card */}
      <div style={{ background:'#1a1a1a', borderRadius:20, padding:'28px 24px', width:'100%', maxWidth:380, border:'1px solid #2a2a2a' }}>
        <div style={{ fontSize:20, fontWeight:700, color:'#fff', marginBottom:4 }}>{title}</div>
        <div style={{ fontSize:13, color:'#555', marginBottom:24 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { signIn, signInGoogle } = useAuth();
  const nav    = useNavigate();
  const [email, setEmail]     = useState('');
  const [pw,    setPw]        = useState('');
  const [err,   setErr]       = useState('');
  const [loading, setLoading] = useState(false);
  const [mode,  setMode]      = useState('login'); // login | reset

  const inp = { width:'100%', padding:'13px 14px', fontSize:15, border:'1.5px solid #333', borderRadius:RADIUS.md, background:'#111', color:'#fff', outline:'none', fontFamily:'inherit', marginBottom:12 };

  const handle = async () => {
    if (!email.trim() || !pw) { setErr('Enter your email and password.'); return; }
    setLoading(true); setErr('');
    try {
      await signIn(email.trim(), pw);
      nav('/dashboard');
    } catch(e) { setErr(AUTH_ERRORS[e.code] || 'Sign in failed. Try again.'); }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true); setErr('');
    try {
      await signInGoogle();
      nav('/dashboard');
    } catch(e) { setErr(AUTH_ERRORS[e.code] || 'Google sign-in failed.'); }
    setLoading(false);
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account">
      {err && <div style={{ background:'#2a0000', border:'1px solid #500', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#f87171', marginBottom:16 }}>{err}</div>}
      <div style={{ marginBottom:4, fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px' }}>Email</div>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={inp} placeholder="you@example.com" autoCapitalize="none"/>
      <div style={{ marginBottom:4, fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px' }}>Password</div>
      <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handle()} style={inp} placeholder="••••••••"/>
      <button onClick={handle} disabled={loading} style={{ width:'100%', background:COLORS.primary, color:'#fff', border:'none', borderRadius:RADIUS.md, padding:'15px', fontSize:16, fontWeight:700, cursor:'pointer', marginBottom:12, fontFamily:'inherit' }}>
        {loading?'Signing in...':'Sign In'}
      </button>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{ flex:1, height:1, background:'#2a2a2a' }}/><span style={{ fontSize:11, color:'#444' }}>or</span><div style={{ flex:1, height:1, background:'#2a2a2a' }}/>
      </div>
      <button onClick={handleGoogle} disabled={loading} style={{ width:'100%', background:'#fff', color:'#111', border:'none', borderRadius:RADIUS.md, padding:'14px', fontSize:15, fontWeight:700, cursor:'pointer', marginBottom:20, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        <GoogleIcon/> Continue with Google
      </button>
      <div style={{ textAlign:'center', fontSize:13, color:'#555' }}>
        Don't have an account? <Link to="/signup" style={{ color:COLORS.primary, textDecoration:'none', fontWeight:700 }}>Sign up</Link>
      </div>
    </AuthShell>
  );
}

export function Signup() {
  const { signUp, signInGoogle } = useAuth();
  const nav = useNavigate();
  const [email, setEmail]     = useState('');
  const [pw,    setPw]        = useState('');
  const [name,  setName]      = useState('');
  const [err,   setErr]       = useState('');
  const [loading, setLoading] = useState(false);

  const inp = { width:'100%', padding:'13px 14px', fontSize:15, border:'1.5px solid #333', borderRadius:RADIUS.md, background:'#111', color:'#fff', outline:'none', fontFamily:'inherit', marginBottom:12 };

  const handle = async () => {
    if (!email.trim()||!pw||!name.trim()) { setErr('Fill in all fields.'); return; }
    if (pw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setLoading(true); setErr('');
    try {
      const cred = await signUp(email.trim(), pw);
      // Business creation happens in onboarding
      nav('/onboarding', { state: { displayName: name.trim() } });
    } catch(e) { setErr(AUTH_ERRORS[e.code] || e.message || 'Sign up failed.'); }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true); setErr('');
    try {
      await signInGoogle();
      nav('/onboarding');
    } catch(e) { setErr(AUTH_ERRORS[e.code] || 'Google sign-in failed.'); }
    setLoading(false);
  };

  return (
    <AuthShell title="Create your account" subtitle="Start your 7-day free trial">
      {err && <div style={{ background:'#2a0000', border:'1px solid #500', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#f87171', marginBottom:16 }}>{err}</div>}
      <div style={{ marginBottom:4, fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px' }}>Your Name</div>
      <input value={name} onChange={e=>setName(e.target.value)} style={inp} placeholder="John Smith"/>
      <div style={{ marginBottom:4, fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px' }}>Email</div>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={inp} placeholder="you@example.com" autoCapitalize="none"/>
      <div style={{ marginBottom:4, fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px' }}>Password</div>
      <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handle()} style={inp} placeholder="At least 6 characters"/>
      <button onClick={handle} disabled={loading} style={{ width:'100%', background:COLORS.primary, color:'#fff', border:'none', borderRadius:RADIUS.md, padding:'15px', fontSize:16, fontWeight:700, cursor:'pointer', marginBottom:12, fontFamily:'inherit' }}>
        {loading?'Creating account...':'Create Account — Free'}
      </button>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{ flex:1, height:1, background:'#2a2a2a' }}/><span style={{ fontSize:11, color:'#444' }}>or</span><div style={{ flex:1, height:1, background:'#2a2a2a' }}/>
      </div>
      <button onClick={handleGoogle} disabled={loading} style={{ width:'100%', background:'#fff', color:'#111', border:'none', borderRadius:RADIUS.md, padding:'14px', fontSize:15, fontWeight:700, cursor:'pointer', marginBottom:20, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        <GoogleIcon/> Continue with Google
      </button>
      <div style={{ textAlign:'center', fontSize:13, color:'#555' }}>
        Already have an account? <Link to="/login" style={{ color:COLORS.primary, textDecoration:'none', fontWeight:700 }}>Sign in</Link>
      </div>
      <div style={{ textAlign:'center', fontSize:11, color:'#444', marginTop:12 }}>
        By signing up you agree to our Terms of Service.
      </div>
    </AuthShell>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
