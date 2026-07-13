#import "RCTNativeDaoewoTts.h"

#import <AVFoundation/AVFoundation.h>

static NSUInteger const DaoewoTtsMaxInputLength = 4000;

static void DaoewoExecuteOnMainQueue(dispatch_block_t block)
{
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

@interface RCTNativeDaoewoTts ()
@property(nonatomic, strong, nullable) AVSpeechSynthesizer *speechSynthesizer;
@end

@implementation RCTNativeDaoewoTts

+ (NSString *)moduleName
{
  return @"NativeDaoewoTts";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDaoewoTtsSpecJSI>(params);
}

- (void)speak:(NSString *)text
       locale:(NSString *)locale
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  NSString *normalizedText =
      [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (normalizedText.length == 0) {
    reject(@"E_TTS_EMPTY_TEXT", @"읽을 텍스트가 비어 있어요.", nil);
    return;
  }
  if (normalizedText.length > DaoewoTtsMaxInputLength) {
    reject(@"E_TTS_TEXT_TOO_LONG", @"읽을 텍스트는 4000자 이하여야 해요.", nil);
    return;
  }

  NSString *normalizedLocale =
      [locale stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (normalizedLocale.length == 0) {
    reject(@"E_TTS_LANGUAGE_UNAVAILABLE", @"TTS 언어가 지정되지 않았어요.", nil);
    return;
  }

  DaoewoExecuteOnMainQueue(^{
    AVSpeechSynthesisVoice *voice =
        [AVSpeechSynthesisVoice voiceWithLanguage:normalizedLocale];
    if (voice == nil) {
      reject(
          @"E_TTS_LANGUAGE_UNAVAILABLE",
          [NSString stringWithFormat:@"설치된 TTS voice가 없어요: %@", normalizedLocale],
          nil);
      return;
    }

    if (self.speechSynthesizer == nil) {
      self.speechSynthesizer = [AVSpeechSynthesizer new];
    }
    if (self.speechSynthesizer.isSpeaking) {
      [self.speechSynthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }

    AVSpeechUtterance *utterance = [[AVSpeechUtterance alloc] initWithString:normalizedText];
    utterance.voice = voice;
    [self.speechSynthesizer speakUtterance:utterance];
    resolve(nil);
  });
}

- (void)stop:(RCTPromiseResolveBlock)resolve
      reject:(__unused RCTPromiseRejectBlock)reject
{
  DaoewoExecuteOnMainQueue(^{
    if (self.speechSynthesizer.isSpeaking) {
      [self.speechSynthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    resolve(nil);
  });
}

- (void)invalidate
{
  DaoewoExecuteOnMainQueue(^{
    if (self.speechSynthesizer.isSpeaking) {
      [self.speechSynthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    self.speechSynthesizer = nil;
  });
}

@end
