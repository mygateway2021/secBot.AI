/* eslint-disable import/no-extraneous-dependencies */
import { useTranslation } from "react-i18next";
import {
  Stack,
  createListCollection,
  Flex,
  Text,
  IconButton,
  Textarea,
  Spinner,
} from "@chakra-ui/react";
import { FiEdit2 } from 'react-icons/fi';
import { useCallback, useMemo, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import { useBgUrl } from "@/context/bgurl-context";
import { settingStyles } from "./setting-styles";
import { useConfig } from "@/context/character-config-context";
import { useGeneralSettings } from "@/hooks/sidebar/setting/use-general-settings";
import { useWebSocket } from "@/context/websocket-context";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogCloseTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toaster } from '@/components/ui/toaster';
import { SelectField, SwitchField, InputField } from "./common";

interface GeneralProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

// Data collection definition
const useCollections = () => {
  const { backgroundFiles } = useBgUrl() || {};
  const { configFiles } = useConfig();

  const languages = createListCollection({
    items: [
      { label: "English", value: "en" },
      { label: "中文", value: "zh" },
    ],
  });

  const backgrounds = createListCollection({
    items:
      backgroundFiles?.map((filename) => ({
        label: String(filename),
        value: `/bg/${filename}`,
      })) || [],
  });

  const characterPresets = createListCollection({
    items: configFiles.map((config) => ({
      label: config.name,
      value: config.filename,
    })),
  });

  return {
    languages,
    backgrounds,
    characterPresets,
  };
};

function General({ onSave, onCancel }: GeneralProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const bgUrlContext = useBgUrl();
  const { confName, setConfName } = useConfig();
  const { wsUrl, setWsUrl, baseUrl, setBaseUrl } = useWebSocket();
  const collections = useCollections();

  const [isCharacterEditorOpen, setIsCharacterEditorOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState('');
  const [isYamlLoading, setIsYamlLoading] = useState(false);
  const [isYamlSaving, setIsYamlSaving] = useState(false);

  const {
    settings,
    handleSettingChange,
    handleCameraToggle,
    handleCharacterPresetChange,
    showSubtitle,
    setShowSubtitle,
  } = useGeneralSettings({
    bgUrlContext,
    confName,
    setConfName,
    baseUrl,
    wsUrl,
    onWsUrlChange: setWsUrl,
    onBaseUrlChange: setBaseUrl,
    onSave,
    onCancel,
  });

  if (settings.language[0] !== i18n.language) {
    handleSettingChange("language", [i18n.language]);
  }

  const selectedCharacterFilename = settings.selectedCharacterPreset?.[0] ?? '';

  const characterConfigUrlBase = useMemo(() => baseUrl.replace(/\/+$/, ''), [baseUrl]);

  const yamlSyntaxError = useMemo((): string | null => {
    if (!isCharacterEditorOpen) return null;
    if (!yamlDraft.trim()) return null;
    try {
      parseYaml(yamlDraft);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [isCharacterEditorOpen, yamlDraft]);

  const loadCharacterYaml = useCallback(async (): Promise<void> => {
    if (!selectedCharacterFilename) return;

    setIsYamlLoading(true);
    try {
      const url = `${characterConfigUrlBase}/character-configs/${encodeURIComponent(selectedCharacterFilename)}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data = await resp.json() as { content?: string };
      setYamlDraft(data.content ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toaster.create({
        title: t('settings.general.configureCharacterLoadFailed'),
        description: message,
        type: 'error',
        duration: 4000,
      });
      setYamlDraft('');
    } finally {
      setIsYamlLoading(false);
    }
  }, [characterConfigUrlBase, selectedCharacterFilename, t]);

  const saveCharacterYaml = useCallback(async (): Promise<void> => {
    if (!selectedCharacterFilename) return;

    setIsYamlSaving(true);
    try {
      const url = `${characterConfigUrlBase}/character-configs/${encodeURIComponent(selectedCharacterFilename)}`;
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yamlDraft }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      toaster.create({
        title: t('settings.general.configureCharacterSaved'),
        type: 'success',
        duration: 2000,
      });
      setIsCharacterEditorOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toaster.create({
        title: t('settings.general.configureCharacterSaveFailed'),
        description: message,
        type: 'error',
        duration: 5000,
      });
    } finally {
      setIsYamlSaving(false);
    }
  }, [characterConfigUrlBase, selectedCharacterFilename, t, yamlDraft]);

  const characterPresetLabel = (
    <Flex align="center" gap={2} minW={0}>
      <Text {...settingStyles.general.field.label} noOfLines={1}>
        {t('settings.general.characterPreset')}
      </Text>
      <IconButton
        aria-label={t('settings.general.configureCharacter')}
        title={t('settings.general.configureCharacter')}
        size="xs"
        variant="ghost"
        color="whiteAlpha.800"
        _hover={{ bg: 'whiteAlpha.200' }}
        isDisabled={!selectedCharacterFilename}
        onClick={async () => {
          setIsCharacterEditorOpen(true);
          await loadCharacterYaml();
        }}
      >
        <FiEdit2 />
      </IconButton>
    </Flex>
  );

  return (
    <Stack {...settingStyles.common.container}>
      <SelectField
        label={t("settings.general.language")}
        value={settings.language}
        onChange={(value) => handleSettingChange("language", value)}
        collection={collections.languages}
        placeholder={t("settings.general.language")}
      />

      <SwitchField
        label={t("settings.general.useCameraBackground")}
        checked={settings.useCameraBackground}
        onChange={handleCameraToggle}
      />

      <SwitchField
        label={t("settings.general.showSubtitle")}
        checked={showSubtitle}
        onChange={setShowSubtitle}
      />

      {!settings.useCameraBackground && (
        <>
          <SelectField
            label={t("settings.general.backgroundImage")}
            value={settings.selectedBgUrl}
            onChange={(value) => handleSettingChange("selectedBgUrl", value)}
            collection={collections.backgrounds}
            placeholder={t("settings.general.backgroundImage")}
          />

          <InputField
            label={t("settings.general.customBgUrl")}
            value={settings.customBgUrl}
            onChange={(value) => handleSettingChange("customBgUrl", value)}
            placeholder={t("settings.general.customBgUrlPlaceholder")}
          />
        </>
      )}

      <SelectField
        label={characterPresetLabel}
        value={settings.selectedCharacterPreset}
        onChange={handleCharacterPresetChange}
        collection={collections.characterPresets}
        placeholder={confName || t("settings.general.characterPreset")}
      />

      <DialogRoot
        open={isCharacterEditorOpen}
        onOpenChange={(e) => {
          if (!e.open) {
            setIsCharacterEditorOpen(false);
          }
        }}
      >
        <DialogContent bg="gray.900" color="white" maxW="900px" w="95vw">
          <DialogHeader>
            <DialogTitle>
              {t('settings.general.configureCharacterTitle', {
                filename: selectedCharacterFilename || 'conf.yaml',
              })}
            </DialogTitle>
            <DialogCloseTrigger />
          </DialogHeader>

          <DialogBody>
            {isYamlLoading ? (
              <Flex align="center" justify="center" minH="240px">
                <Spinner />
              </Flex>
            ) : (
              <>
                <Textarea
                  value={yamlDraft}
                  onChange={(e) => setYamlDraft(e.target.value)}
                  fontFamily="mono"
                  fontSize="sm"
                  minH="60vh"
                  bg="blackAlpha.400"
                  borderColor={yamlSyntaxError ? 'red.400' : 'whiteAlpha.300'}
                  _hover={{ borderColor: yamlSyntaxError ? 'red.300' : 'whiteAlpha.400' }}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                />
                {yamlSyntaxError && (
                  <Text mt={2} fontSize="sm" color="red.300">
                    {t('settings.general.yamlSyntaxInvalid')}: {yamlSyntaxError}
                  </Text>
                )}
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              colorPalette="gray"
              onClick={() => setIsCharacterEditorOpen(false)}
              disabled={isYamlSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              colorPalette="blue"
              onClick={saveCharacterYaml}
              loading={isYamlSaving}
              disabled={!selectedCharacterFilename || isYamlLoading || Boolean(yamlSyntaxError)}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <InputField
        label={t("settings.general.wsUrl")}
        value={settings.wsUrl}
        onChange={(value) => handleSettingChange("wsUrl", value)}
        placeholder="Enter WebSocket URL"
      />

      <InputField
        label={t("settings.general.baseUrl")}
        value={settings.baseUrl}
        onChange={(value) => handleSettingChange("baseUrl", value)}
        placeholder="Enter Base URL"
      />

      <InputField
        label={t("settings.general.imageCompressionQuality")}
        value={settings.imageCompressionQuality.toString()}
        onChange={(value) => {
          const quality = parseFloat(value as string);
          if (!Number.isNaN(quality) && quality >= 0.1 && quality <= 1.0) {
            handleSettingChange("imageCompressionQuality", quality);
          } else if (value === "") {
            handleSettingChange("imageCompressionQuality", settings.imageCompressionQuality);
          }
        }}
        help={t("settings.general.imageCompressionQualityHelp")}
      />

      <InputField
        label={t("settings.general.imageMaxWidth")}
        value={settings.imageMaxWidth.toString()}
        onChange={(value) => {
          const maxWidth = parseInt(value as string, 10);
          if (!Number.isNaN(maxWidth) && maxWidth >= 0) {
            handleSettingChange("imageMaxWidth", maxWidth);
          } else if (value === "") {
            handleSettingChange("imageMaxWidth", settings.imageMaxWidth);
          }
        }}
        help={t("settings.general.imageMaxWidthHelp")}
      />
    </Stack>
  );
}

export default General;
