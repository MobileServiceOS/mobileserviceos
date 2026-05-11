import { useEffect, useState } from 'react';
import { APP_LOGO } from '@/lib/defaults';
import { addToast } from '@/lib/toast';
import { getInstallPrompt, clearInstallPrompt } from '@/lib/pwa';

export function InstallBanner() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('msos_install_dismissed');
    if (dismissed) return;
    const ua = navigator.userAgent || '';
    const standalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone) return;
    const ios = /iPhone|iPad|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
    if (ios) {
      setIsIOS(true);
      const t = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(t);
    }
    if (getInstallPrompt()) {
      const t = setTimeout(() => setShow(true), 2500);
      return () => clearTimeout(t);
    }
    const onAvail = () => {
      if (!localStorage.getItem('msos_install_dismissed')) {
        setTimeout(() => setShow(true), 2500);
      }
    };
    window.addEventListener('msos:install-available', onAvail);
    return () => window.removeEventListener('msos:install-available', onAvail);
  }, []);

  if (!show) return null;

  const install = async () => {
    if (isIOS) {
      alert('To install: tap the Share button in Safari, then "Add to Home Screen".');
      return;
    }
    const p = getInstallPrompt();
    if (!p) return;
    p.prompt();
    const { outcome } = await p.userChoice;
    clearInstallPrompt();
    setShow(false);
    if (outcome === 'accepted') addToast('Installing app', 'success');
  };
  const dismiss = () => {
    localStorage.setItem('msos_install_dismissed', '1');
    setShow(false);
  };

  return (
    <div className="install-banner" role="dialog" aria-label="Install app">
      <img src={APP_LOGO} className="install-banner-icon" alt="" />
      <div className="install-banner-text">
        <div className="install-banner-title">{isIOS ? 'Add to Home Screen' : 'Install Mobile Service OS'}</div>
        <div className="install-banner-sub">{isIOS ? 'Tap Share → Add to Home Screen' : 'Faster access · works offline'}</div>
      </div>
      <div className="install-banner-actions">
        <button className="btn xs secondary" onClick={dismiss}>Later</button>
        <button className="btn xs primary" onClick={install}>{isIOS ? 'How' : 'Install'}</button>
      </div>
    </div>
  );
}
