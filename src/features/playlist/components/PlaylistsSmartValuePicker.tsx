import { useTranslation } from 'react-i18next';
import CustomSelect from '@/ui/CustomSelect';

export interface SmartValueOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: readonly SmartValueOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  ariaInvalid?: boolean;
}

export default function PlaylistsSmartValuePicker({
  value, options, onChange, ariaLabel, className = '', ariaInvalid,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="smart-field-picker">
      <CustomSelect
        value={value}
        options={options}
        onChange={onChange}
        className={className}
        ariaLabel={ariaLabel}
        ariaInvalid={ariaInvalid}
        searchable
        allowCustomValue
        searchPlaceholder={t('smartPlaylists.valueSearchPlaceholder')}
        emptyMessage={t('smartPlaylists.valueSearchEmpty')}
        minDropdownWidth={220}
      />
    </div>
  );
}
