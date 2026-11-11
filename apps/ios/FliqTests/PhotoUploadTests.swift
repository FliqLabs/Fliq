import UIKit
import XCTest
@testable import Fliq

final class PhotoUploadTests: XCTestCase {
    func testTheUploadFormCarriesThePresetAndTheJPEG() {
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let body = CloudinaryUploads.form(jpeg, preset: "fliq_avatars", boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("--B\r\n"))
        XCTAssertTrue(text.contains("name=\"upload_preset\"\r\n\r\nfliq_avatars\r\n"))
        XCTAssertTrue(text.contains("filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"))
        XCTAssertNotNil(body.range(of: jpeg))
        XCTAssertTrue(text.hasSuffix("--B--\r\n"))
    }

    func testAPhotoIsCroppedToASmallSquare() throws {
        let wide = UIGraphicsImageRenderer(size: CGSize(width: 3000, height: 2000)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 3000, height: 2000))
        }
        let prepared = try XCTUnwrap(ProfilePhoto.prepare(try XCTUnwrap(wide.pngData())))
        let image = try XCTUnwrap(UIImage(data: prepared))
        XCTAssertEqual(image.size.width * image.scale, 512)
        XCTAssertEqual(image.size.height * image.scale, 512)
        XCTAssertLessThan(prepared.count, 200_000)
        XCTAssertNil(ProfilePhoto.prepare(Data("not an image".utf8)))
    }

    @MainActor
    func testSavingTheProfileUploadsThePhotoWhenLive() async throws {
        let uploads = RecordingUploads()
        let flow = OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory(), isLive: true, keys: NoKeys(), photos: uploads)
        flow.displayName = "Dara"
        flow.photo = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { _ in }.pngData()
        await flow.saveProfile()
        let sent = await uploads.count
        XCTAssertEqual(sent, 1)
    }

    private actor RecordingUploads: PhotoUploads {
        private(set) var count = 0
        func upload(_ jpeg: Data) async throws -> URL {
            count += 1
            return URL(string: "https://res.cloudinary.com/fliq/image/upload/a.jpg")!
        }
    }

    private struct NoKeys: DeviceKeys {
        func publicKey() throws -> String { "ed25519:11111111111111111111111111111111" }
    }
}
