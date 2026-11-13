import AVFoundation
import SwiftUI

/// A silent video from the app bundle that fills its frame and loops. It holds its first frame when `plays` is false.
struct LoopingVideo: UIViewRepresentable {
    let resource: String
    var plays = true

    func makeUIView(context: Context) -> LoopingVideoView {
        LoopingVideoView(url: Bundle.main.url(forResource: resource, withExtension: "mp4"))
    }

    func updateUIView(_ view: LoopingVideoView, context: Context) {
        view.plays = plays
    }
}

final class LoopingVideoView: UIView {
    override static var layerClass: AnyClass { AVPlayerLayer.self }

    private let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?

    var plays = true {
        didSet { plays ? player.play() : player.pause() }
    }

    init(url: URL?) {
        super.init(frame: .zero)
        backgroundColor = .black
        player.isMuted = true
        player.allowsExternalPlayback = false
        player.preventsDisplaySleepDuringVideoPlayback = false
        if let url {
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        }
        if let layer = layer as? AVPlayerLayer {
            layer.player = player
            layer.videoGravity = .resizeAspectFill
        }
        // iOS pauses video when the app leaves the screen and does not start it again.
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
        player.play()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func resume() {
        if plays { player.play() }
    }
}
