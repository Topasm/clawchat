import { PaneSection, SectionHeader } from './WorkspacePrimitives';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
  /** Anchor, so another part of the app can bring this section into view. */
  id?: string;
}

export default function SettingsSection({ title, children, id }: SettingsSectionProps) {
  return (
    <PaneSection className="cc-settings-section" id={id}>
      <SectionHeader as="div" className="cc-settings-section__title">
        {title}
      </SectionHeader>
      {children}
    </PaneSection>
  );
}
