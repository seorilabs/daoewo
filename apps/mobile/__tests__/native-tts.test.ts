import type { Spec as NativeDaoewoTtsModule } from '../specs/NativeDaoewoTts';
import {
  createNativeTtsAdapter,
  NATIVE_TTS_MAX_INPUT_LENGTH,
  normalizeSpeechLocale,
} from '../src/native-tts';

function createModule(): jest.Mocked<NativeDaoewoTtsModule> {
  return {
    speak: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };
}

describe('native TTS adapter', () => {
  it('텍스트를 정리하고 화면 locale을 BCP 47로 변환해 전달한다', async () => {
    const nativeModule = createModule();
    const tts = createNativeTtsAdapter(nativeModule);

    expect(tts.availability).toBe('available');
    await expect(tts.speak('  hello  ', '영어')).resolves.toBeUndefined();

    expect(nativeModule.speak).toHaveBeenCalledWith('hello', 'en-US');
  });

  it('이미 전달된 BCP 47 locale은 정규화해서 보존한다', () => {
    expect(normalizeSpeechLocale('zh_hant_tw')).toBe('zh-Hant-TW');
    expect(normalizeSpeechLocale('일본어')).toBe('ja-JP');
    expect(normalizeSpeechLocale(undefined)).toBe('ko-KR');
  });

  it('빈 입력과 native 한도를 넘는 입력은 module 호출 전에 거부한다', async () => {
    const nativeModule = createModule();
    const tts = createNativeTtsAdapter(nativeModule);

    await expect(tts.speak(' \n ', '한국어')).rejects.toThrow('비어');
    await expect(
      tts.speak('가'.repeat(NATIVE_TTS_MAX_INPUT_LENGTH + 1), '한국어'),
    ).rejects.toThrow('4,000자');
    expect(nativeModule.speak).not.toHaveBeenCalled();
  });

  it('module 부재는 동기 crash 대신 Promise 실패로 닫고 stop은 안전하게 끝낸다', async () => {
    const tts = createNativeTtsAdapter(null);

    expect(tts.availability).toBe('unsupported');
    await expect(tts.speak('hello', 'en-US')).rejects.toThrow('네이티브 TTS');
    await expect(tts.stop()).resolves.toBeUndefined();
  });

  it('native speak/stop Promise 결과를 그대로 전달한다', async () => {
    const nativeModule = createModule();
    const tts = createNativeTtsAdapter(nativeModule);
    nativeModule.speak.mockRejectedValueOnce(new Error('voice unavailable'));

    await expect(tts.speak('hello', 'en-US')).rejects.toThrow(
      'voice unavailable',
    );
    await expect(tts.stop()).resolves.toBeUndefined();
    expect(nativeModule.stop).toHaveBeenCalledTimes(1);
  });
});
