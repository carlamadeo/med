import { useEffect, useState } from 'preact/hooks';

const STORAGE_KEY = 'mis-estudios-onboarding-seen';

export function OnboardingDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.localStorage.getItem(STORAGE_KEY)) setOpen(true);
  }, []);

  const close = () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  if (!open) return null;
  return (
    <dialog className="dialog onboarding" open aria-labelledby="onboarding-title">
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">EMPEZÁ EN TRES PASOS</p>
          <h2 id="onboarding-title">Tu archivo médico, ordenado</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Cerrar introducción" onClick={close}>×</button>
      </div>
      <ol className="onboarding-steps">
        <li><strong>Conectá Drive</strong><span>Usamos tu cuenta para guardar tus datos privados.</span></li>
        <li><strong>Subí el PDF</strong><span>Podemos sugerir la fecha, el tipo y el médico.</span></li>
        <li><strong>Encontrá todo rápido</strong><span>Filtrá por fecha, tipo, portal u operación.</span></li>
      </ol>
      <div className="dialog-actions">
        <button className="button primary" type="button" onClick={close}>Entendido</button>
      </div>
    </dialog>
  );
}
