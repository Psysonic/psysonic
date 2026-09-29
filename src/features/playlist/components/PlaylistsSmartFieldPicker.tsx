import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from '@/ui/CustomSelect';
import {
  searchSmartRuleFields,
  type SmartPlaylistCapabilities,
  type SmartRuleFieldDefinition,
} from '@/features/playlist/utils/smartPlaylistFields';

interface Props {
  value: string;
  capabilities: SmartPlaylistCapabilities;
  customFields: readonly SmartRuleFieldDefinition[];
  onChange: (field: SmartRuleFieldDefinition) => void;
  sortableOnly?: boolean;
  className?: string;
  ariaInvalid?: boolean;
}

export default function PlaylistsSmartFieldPicker({
  value, capabilities, customFields, onChange, sortableOnly = false,
  className = '', ariaInvalid,
}: Props) {
  const { t } = useTranslation();
  const fields = useMemo(
    () => searchSmartRuleFields('', capabilities, customFields)
      .filter(field => (sortableOnly ? field.sortable !== false : field.filterable !== false)),
    [capabilities, customFields, sortableOnly],
  );

  return (
    <div className="smart-field-picker">
      <CustomSelect
        value={value}
        options={fields.map(field => ({ value: field.name, label: field.label }))}
        onChange={next => {
          const field = fields.find(item => item.name === next);
          if (field) onChange(field);
        }}
        className={className}
        ariaLabel={t('smartPlaylists.field')}
        ariaInvalid={ariaInvalid}
        searchable
        searchPlaceholder={t('smartPlaylists.fieldSearchPlaceholder')}
        emptyMessage={t('smartPlaylists.fieldSearchEmpty')}
        minDropdownWidth={220}
      />
    </div>
  );
}
