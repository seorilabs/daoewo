#import "RCTNativeDaoewoNotifications.h"

#import <UserNotifications/UserNotifications.h>

#include <cmath>

static NSString *const DaoewoDailyReminderIdentifier = @"daoewo.daily-reminder";
static NSString *const DaoewoReviewReminderIdentifier = @"daoewo.review-reminder";
static double const DaoewoNoReviewAtEpochMs = -1.0;
typedef void (^DaoewoNotificationRequestsCompletion)(NSError *_Nullable error);

static NSArray<NSString *> *DaoewoReminderIdentifiers(void)
{
  return @[ DaoewoDailyReminderIdentifier, DaoewoReviewReminderIdentifier ];
}

static void DaoewoExecuteNotificationsOnMainQueue(dispatch_block_t block)
{
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

static UNNotificationRequest *DaoewoDailyReminderRequest(void)
{
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"다외워 학습 시간";
  content.body = @"오늘의 학습을 이어가 보세요.";
  content.sound = UNNotificationSound.defaultSound;

  // timezone을 고정하지 않아 기기의 현재 지역 기준 매일 09:00에 반복한다.
  NSDateComponents *components = [NSDateComponents new];
  components.hour = 9;
  components.minute = 0;
  UNCalendarNotificationTrigger *trigger =
      [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:YES];
  return [UNNotificationRequest requestWithIdentifier:DaoewoDailyReminderIdentifier
                                              content:content
                                              trigger:trigger];
}

static UNNotificationRequest *DaoewoReviewReminderRequest(double nextReviewAtEpochMs)
{
  NSTimeInterval requestedAt = nextReviewAtEpochMs / 1000.0;
  NSTimeInterval earliestAt = NSDate.date.timeIntervalSince1970 + 1.0;
  NSDate *fireDate = [NSDate dateWithTimeIntervalSince1970:MAX(requestedAt, earliestAt)];
  NSCalendar *calendar = NSCalendar.currentCalendar;
  NSDateComponents *components =
      [calendar components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay |
                            NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond)
                  fromDate:fireDate];
  // 복습 예정 시각은 절대 시각이므로 예약 당시 timezone과 함께 저장한다.
  components.timeZone = calendar.timeZone;

  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"복습할 시간이에요";
  content.body = @"기억이 흐려지기 전에 복습을 시작해 보세요.";
  content.sound = UNNotificationSound.defaultSound;
  UNCalendarNotificationTrigger *trigger =
      [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
  return [UNNotificationRequest requestWithIdentifier:DaoewoReviewReminderIdentifier
                                              content:content
                                              trigger:trigger];
}

static NSArray<UNNotificationRequest *> *DaoewoExistingReminderRequests(
    NSArray<UNNotificationRequest *> *requests)
{
  NSSet<NSString *> *identifiers = [NSSet setWithArray:DaoewoReminderIdentifiers()];
  NSPredicate *predicate = [NSPredicate predicateWithBlock:^BOOL(
      UNNotificationRequest *request,
      __unused NSDictionary<NSString *, id> *bindings) {
    return [identifiers containsObject:request.identifier];
  }];
  return [requests filteredArrayUsingPredicate:predicate];
}

static NSArray<NSString *> *DaoewoDisabledReminderIdentifiers(
    NSArray<UNNotificationRequest *> *requests)
{
  NSMutableSet<NSString *> *enabled = [NSMutableSet new];
  for (UNNotificationRequest *request in requests) {
    [enabled addObject:request.identifier];
  }
  NSMutableArray<NSString *> *disabled = [NSMutableArray new];
  for (NSString *identifier in DaoewoReminderIdentifiers()) {
    if (![enabled containsObject:identifier]) {
      [disabled addObject:identifier];
    }
  }
  return disabled;
}

@interface RCTNativeDaoewoNotifications ()
- (void)addRequests:(NSArray<UNNotificationRequest *> *)requests
              index:(NSUInteger)index
             center:(UNUserNotificationCenter *)center
         completion:(DaoewoNotificationRequestsCompletion)completion;
- (void)restoreRequests:(NSArray<UNNotificationRequest *> *)requests
                 center:(UNUserNotificationCenter *)center
             completion:(DaoewoNotificationRequestsCompletion)completion;
@end

@implementation RCTNativeDaoewoNotifications

+ (NSString *)moduleName
{
  return @"NativeDaoewoNotifications";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDaoewoNotificationsSpecJSI>(params);
}

- (void)requestPermission:(RCTPromiseResolveBlock)resolve
                   reject:(__unused RCTPromiseRejectBlock)reject
{
  DaoewoExecuteNotificationsOnMainQueue(^{
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      DaoewoExecuteNotificationsOnMainQueue(^{
        switch (settings.authorizationStatus) {
          case UNAuthorizationStatusAuthorized:
          case UNAuthorizationStatusProvisional:
          case UNAuthorizationStatusEphemeral:
            resolve(@YES);
            return;
          case UNAuthorizationStatusDenied:
            resolve(@NO);
            return;
          case UNAuthorizationStatusNotDetermined:
            break;
        }

        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                                  UNAuthorizationOptionBadge |
                                                  UNAuthorizationOptionSound)
                              completionHandler:^(BOOL granted, __unused NSError *_Nullable error) {
          DaoewoExecuteNotificationsOnMainQueue(^{
            resolve(@(granted));
          });
        }];
      });
    }];
  });
}

- (void)applyPreferences:(BOOL)dailyReminder
          reviewReminder:(BOOL)reviewReminder
     nextReviewAtEpochMs:(double)nextReviewAtEpochMs
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  if (!std::isfinite(nextReviewAtEpochMs) ||
      (nextReviewAtEpochMs != DaoewoNoReviewAtEpochMs && nextReviewAtEpochMs <= 0)) {
    reject(@"E_NOTIFICATIONS_INVALID_REVIEW_DATE", @"복습 알림 시각이 올바르지 않아요.", nil);
    return;
  }

  DaoewoExecuteNotificationsOnMainQueue(^{
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    NSArray<NSString *> *identifiers = DaoewoReminderIdentifiers();

    if (!dailyReminder && !reviewReminder) {
      [center removePendingNotificationRequestsWithIdentifiers:identifiers];
      [center removeDeliveredNotificationsWithIdentifiers:identifiers];
      resolve(nil);
      return;
    }

    [center getPendingNotificationRequestsWithCompletionHandler:
                ^(NSArray<UNNotificationRequest *> *pendingRequests) {
      DaoewoExecuteNotificationsOnMainQueue(^{
        NSArray<UNNotificationRequest *> *previousRequests =
            DaoewoExistingReminderRequests(pendingRequests);
        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                              completionHandler:^(BOOL granted, NSError *_Nullable error) {
          DaoewoExecuteNotificationsOnMainQueue(^{
            if (error != nil) {
              reject(@"E_NOTIFICATIONS_PERMISSION", @"알림 권한을 확인하지 못했어요.", error);
              return;
            }
            if (!granted) {
              reject(@"E_NOTIFICATIONS_PERMISSION_DENIED", @"알림 권한이 허용되지 않았어요.", nil);
              return;
            }

            NSMutableArray<UNNotificationRequest *> *requests = [NSMutableArray new];
            if (dailyReminder) {
              [requests addObject:DaoewoDailyReminderRequest()];
            }
            if (reviewReminder && nextReviewAtEpochMs > 0) {
              [requests addObject:DaoewoReviewReminderRequest(nextReviewAtEpochMs)];
            }

            [self addRequests:requests
                        index:0
                       center:center
                   completion:^(NSError *_Nullable scheduleError) {
              if (scheduleError == nil) {
                NSArray<NSString *> *disabled = DaoewoDisabledReminderIdentifiers(requests);
                [center removePendingNotificationRequestsWithIdentifiers:disabled];
                [center removeDeliveredNotificationsWithIdentifiers:identifiers];
                resolve(nil);
                return;
              }

              [self restoreRequests:previousRequests
                             center:center
                         completion:^(NSError *_Nullable rollbackError) {
                if (rollbackError != nil) {
                  reject(
                      @"E_NOTIFICATIONS_ROLLBACK",
                      @"알림 예약과 기존 설정 복원에 실패했어요.",
                      rollbackError);
                  return;
                }
                reject(
                    @"E_NOTIFICATIONS_SCHEDULE",
                    @"알림을 예약하지 못해 기존 설정을 유지했어요.",
                    scheduleError);
              }];
            }];
          });
        }];
      });
    }];
  });
}

- (void)clear:(RCTPromiseResolveBlock)resolve
       reject:(__unused RCTPromiseRejectBlock)reject
{
  DaoewoExecuteNotificationsOnMainQueue(^{
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    NSArray<NSString *> *identifiers = DaoewoReminderIdentifiers();
    [center removePendingNotificationRequestsWithIdentifiers:identifiers];
    [center removeDeliveredNotificationsWithIdentifiers:identifiers];
    resolve(nil);
  });
}

- (void)addRequests:(NSArray<UNNotificationRequest *> *)requests
              index:(NSUInteger)index
             center:(UNUserNotificationCenter *)center
         completion:(DaoewoNotificationRequestsCompletion)completion
{
  if (index >= requests.count) {
    completion(nil);
    return;
  }

  [center addNotificationRequest:requests[index]
           withCompletionHandler:^(NSError *_Nullable error) {
    DaoewoExecuteNotificationsOnMainQueue(^{
      if (error != nil) {
        completion(error);
        return;
      }
      [self addRequests:requests
                  index:index + 1
                 center:center
             completion:completion];
    });
  }];
}

- (void)restoreRequests:(NSArray<UNNotificationRequest *> *)requests
                 center:(UNUserNotificationCenter *)center
             completion:(DaoewoNotificationRequestsCompletion)completion
{
  [center removePendingNotificationRequestsWithIdentifiers:
              DaoewoDisabledReminderIdentifiers(requests)];
  [self addRequests:requests index:0 center:center completion:completion];
}

@end
