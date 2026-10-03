import { correctionPromptOn } from "./correction";
import { isOnDeviceProvider } from "./ondevice/bridge";
import { effectiveSystemPrompt, type AppSettings } from "./settings";

/**
 * System prompt for one reply on one chat. Fresh sends, resends, and
 * resumed native turns all build it here, so a retry carries the same
 * hints as the first try: the lookup hint whenever fetch_url is on
 * offer (every cloud provider), the correction line when the chat
 * asks for it.
 */
export function replySystemPrompt(
	settings: AppSettings,
	replyCode: string | null | undefined,
	chat: { correction?: boolean; replyLang: string | null } | undefined
): string {
	return effectiveSystemPrompt(
		settings,
		replyCode,
		!isOnDeviceProvider(settings.activeProviderId),
		correctionPromptOn(chat?.correction, chat?.replyLang ?? null)
	);
}
