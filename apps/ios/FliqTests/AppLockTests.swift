import XCTest
@testable import Fliq

@MainActor
final class AppLockTests: XCTestCase {
    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
    }

    private var clock = Clock()

    private func makeLock() -> AppLock {
        let suite = "lock-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        defaults.removePersistentDomain(forName: suite)
        let clock = clock
        return AppLock(defaults: defaults, keychain: nil, now: { clock.now })
    }

    func testThePasscodeOpensTheLockAndAWrongOneDoesNot() {
        let lock = makeLock()
        lock.setPasscode("482913")
        lock.launched()
        XCTAssertTrue(lock.isLocked)

        XCTAssertEqual(lock.check("000000"), .wrong(left: 4))
        XCTAssertTrue(lock.isLocked)
        XCTAssertEqual(lock.check("482913"), .unlocked)
        XCTAssertFalse(lock.isLocked)
    }

    func testOnlyASixDigitPasscodeIsKept() {
        let lock = makeLock()
        lock.setPasscode("12345")
        lock.setPasscode("12345a")
        XCTAssertFalse(lock.hasPasscode)
        lock.setPasscode("123456")
        XCTAssertTrue(lock.hasPasscode)
    }

    func testFiveWrongTriesWaitThirtySecondsThenDouble() {
        let lock = makeLock()
        lock.setPasscode("482913")
        lock.launched()
        for left in stride(from: 4, through: 1, by: -1) {
            XCTAssertEqual(lock.check("111111"), .wrong(left: left))
        }
        XCTAssertEqual(lock.check("111111"), .wait(until: clock.now.addingTimeInterval(30)))

        XCTAssertEqual(lock.check("482913"), .wait(until: clock.now.addingTimeInterval(30)), "even the right passcode waits")
        clock.now.addTimeInterval(31)
        XCTAssertEqual(lock.check("111111"), .wait(until: clock.now.addingTimeInterval(60)))

        clock.now.addTimeInterval(61)
        XCTAssertEqual(lock.check("482913"), .unlocked)
        lock.launched()
        XCTAssertEqual(lock.check("111111"), .wrong(left: 4), "unlocking starts the count again")
    }

    func testItLocksAfterTheDelayInTheBackgroundOnly() {
        let lock = makeLock()
        lock.useBiometrics(true)
        lock.setDelay(.oneMinute)

        lock.movedToBackground()
        clock.now.addTimeInterval(30)
        lock.cameToForeground()
        XCTAssertFalse(lock.isLocked)

        lock.movedToBackground()
        clock.now.addTimeInterval(61)
        lock.cameToForeground()
        XCTAssertTrue(lock.isLocked)
    }

    func testImmediatelyLocksOnAnyReturn() {
        let lock = makeLock()
        lock.setPasscode("482913")
        lock.setDelay(.immediately)
        lock.movedToBackground()
        lock.cameToForeground()
        XCTAssertTrue(lock.isLocked)
    }

    func testSkippingSetupNeverLocks() {
        let lock = makeLock()
        XCTAssertTrue(lock.needsSetup)
        lock.skip()
        XCTAssertFalse(lock.needsSetup)

        lock.launched()
        lock.movedToBackground()
        clock.now.addTimeInterval(3600)
        lock.cameToForeground()
        XCTAssertFalse(lock.isLocked)
    }

    func testResetClearsEverythingAndAsksAgain() {
        let lock = makeLock()
        lock.setPasscode("482913")
        lock.useBiometrics(true)
        lock.reset()
        XCTAssertFalse(lock.isEnabled)
        XCTAssertTrue(lock.needsSetup)
    }

    func testNamesShowWithoutTheNEARSuffix() {
        XCTAssertEqual(FliqName.display("frank" + FliqName.suffix), "@frank")
        XCTAssertEqual(FliqName.display("someone.near"), "someone.near")
        XCTAssertEqual(FliqName.account(typed: "@Frank "), "frank" + FliqName.suffix)
        XCTAssertEqual(FliqName.account(typed: "frank" + FliqName.suffix), "frank" + FliqName.suffix)
        XCTAssertNil(FliqName.account(typed: "-bad"))
    }
}
