import { correctionPromptOn } from "./correction";
import { isOnDeviceProvider } from "./ondevice/bridge";
import { effectiveSystemPrompt, type AppSettings } from "./settings";
import { isDeepSeekProvider } from "./providers/deepseek";
import { appGuidePrompt } from "./app-help";

/**
 * System prompt for one reply on one chat. Fresh sends, resends, and
 * resumed native turns all build it here, so a retry carries the same
 * hints as the first try: the lookup hint for every cloud provider
 * (fetch_url, or DeepSeek's own web tools), the correction line when
 * the chat asks for it.
 */
export function replySystemPrompt(
	settings: AppSettings,
	replyCode: string | null | undefined,
	chat: { correction?: boolean; replyLang: string | null } | undefined
): string {
	const prompt = effectiveSystemPrompt(
		settings,
		replyCode,
		!isOnDeviceProvider(settings.activeProviderId),
		correctionPromptOn(chat?.correction, chat?.replyLang ?? null)
	);
	// DeepSeek's web tools can't share a request with fetch_url, so the
	// app's guide (which fetch_url serves everyone else on demand) rides
	// along: a cached prefix, so it costs next to nothing per turn.
	return isDeepSeekProvider(settings.activeProviderId)
		? `${prompt}\n\n${appGuidePrompt()}`
		: prompt;
}
