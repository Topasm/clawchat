import { useSkillsQuery } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import { skillLabel } from '../../utils/skillLabels';

interface SkillChainPickerProps {
  /** Skill ids in the order they run. */
  value: string[];
  onChange: (chain: string[]) => void;
  /** Skills that cannot be chained; `plan` has its own proposal flow. */
  exclude?: readonly string[];
  /** The server refuses longer chains. */
  max?: number;
}

/**
 * A skill chain as an ordered list of steps with one place to add the next.
 *
 * A run applies its chain in order, so the list reads like the run will go:
 * "Research → Summarize". Each step can be removed; a skill already in the
 * chain is not offered again.
 */
export default function SkillChainPicker({
  value,
  onChange,
  exclude = ['plan'],
  max = 6,
}: SkillChainPickerProps) {
  const { data } = useSkillsQuery();
  const skills = (data?.skills ?? []).filter((skill) => !exclude.includes(skill.id));
  const addable = skills.filter((skill) => !value.includes(skill.id));
  return (
    <div className="cc-skill-chain">
      <ol className="cc-skill-chain__steps" aria-label={translateUi('Skill chain')}>
        {value.map((skillId, index) => (
          <li key={skillId} className="cc-skill-chain__step">
            <span>{skillLabel(skillId)}</span>
            <button
              type="button"
              className="cc-skill-chain__remove"
              aria-label={translateUi('Remove {{skill}}', { skill: skillLabel(skillId) })}
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              ×
            </button>
          </li>
        ))}
        {value.length === 0 && (
          <li className="cc-skill-chain__empty">{translateUi('No skills chosen')}</li>
        )}
      </ol>
      {value.length < max && addable.length > 0 && (
        <select
          className="cc-settings-input cc-skill-chain__add"
          value=""
          aria-label={translateUi('Add a skill')}
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value]);
          }}
        >
          <option value="">{translateUi('Add a skill…')}</option>
          {addable.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skillLabel(skill.id)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
