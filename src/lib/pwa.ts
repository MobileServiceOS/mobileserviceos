interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

let _deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

export function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('msos:install-available'));
  });
}

export function getInstallPrompt() {
  return _deferredInstallPrompt;
}

export function clearInstallPrompt() {
  _deferredInstallPrompt = null;
}
