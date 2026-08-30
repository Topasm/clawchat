import { PropertyRow } from './WorkspacePrimitives';

interface SettingsRowProps {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}

export default function SettingsRow({ label, sublabel, children }: SettingsRowProps) {
  return (
    <PropertyRow className="cc-settings-row">
      <div>
        <div className="cc-settings-row__label">{label}</div>
        {sublabel && <div className="cc-settings-row__sublabel">{sublabel}</div>}
      </div>
      <div className="cc-settings-row__control">{children}</div>
    </PropertyRow>
  );
}
