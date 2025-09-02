"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Star, ThumbsUp, ThumbsDown } from "lucide-react"

// Sample reviews data
const reviews = [
  {
    id: "1",
    author: "Sarah Johnson",
    avatar: "/placeholder.svg?key=avatar1",
    rating: 5,
    date: "2024-01-15",
    title: "Excellent sound quality!",
    content:
      "These headphones exceeded my expectations. The noise cancellation works perfectly and the battery life is amazing. Highly recommended for anyone looking for premium audio experience.",
    verified: true,
    helpful: 24,
    unhelpful: 2,
  },
  {
    id: "2",
    author: "Mike Chen",
    avatar: "/placeholder.svg?key=avatar2",
    rating: 4,
    date: "2024-01-10",
    title: "Great value for money",
    content:
      "Good build quality and comfortable to wear for long periods. The only minor issue is that they can feel a bit tight at first, but they break in nicely after a few days of use.",
    verified: true,
    helpful: 18,
    unhelpful: 1,
  },
  {
    id: "3",
    author: "Emily Davis",
    avatar: "/placeholder.svg?key=avatar3",
    rating: 5,
    date: "2024-01-08",
    title: "Perfect for commuting",
    content:
      "I use these daily for my commute and they're fantastic. The noise cancellation blocks out all the train noise and the quick charge feature is a lifesaver when I forget to charge them overnight.",
    verified: true,
    helpful: 31,
    unhelpful: 0,
  },
]

interface ProductReviewsProps {
  productId: string
  rating: number
  reviewCount: number
}

export function ProductReviews({ productId, rating, reviewCount }: ProductReviewsProps) {
  const [showWriteReview, setShowWriteReview] = useState(false)

  // Sample rating distribution
  const ratingDistribution = [
    { stars: 5, count: 847, percentage: 68 },
    { stars: 4, count: 312, percentage: 25 },
    { stars: 3, count: 62, percentage: 5 },
    { stars: 2, count: 19, percentage: 1.5 },
    { stars: 1, count: 7, percentage: 0.5 },
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold">Customer Reviews</h2>
        <Button onClick={() => setShowWriteReview(!showWriteReview)}>Write a Review</Button>
      </div>

      {/* Write Review Form */}
      {showWriteReview && (
        <Card>
          <CardHeader>
            <CardTitle>Write Your Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} className="p-1">
                    <Star className="h-6 w-6 text-muted-foreground hover:text-yellow-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Review Title</label>
              <input
                type="text"
                placeholder="Summarize your experience"
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Your Review</label>
              <Textarea placeholder="Share your thoughts about this product..." className="min-h-[120px]" />
            </div>
            <div className="flex gap-2">
              <Button>Submit Review</Button>
              <Button variant="outline" onClick={() => setShowWriteReview(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rating Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-4xl font-bold">{rating}</div>
            <div>
              <div className="flex items-center mb-1">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`h-5 w-5 ${
                      i < Math.floor(rating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                    }`}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{reviewCount} reviews</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {ratingDistribution.map((item) => (
            <div key={item.stars} className="flex items-center gap-2">
              <span className="text-sm w-8">{item.stars}★</span>
              <Progress value={item.percentage} className="flex-1" />
              <span className="text-sm text-muted-foreground w-12">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Individual Reviews */}
      <div className="space-y-6">
        {reviews.map((review) => (
          <Card key={review.id}>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <Avatar>
                  <AvatarImage src={review.avatar || "/placeholder.svg"} alt={review.author} />
                  <AvatarFallback>
                    {review.author
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{review.author}</span>
                        {review.verified && (
                          <Badge variant="secondary" className="text-xs">
                            Verified Purchase
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center">
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              className={`h-4 w-4 ${
                                i < review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {new Date(review.date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">{review.title}</h4>
                    <p className="text-muted-foreground leading-relaxed">{review.content}</p>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">Was this helpful?</span>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-8 px-2">
                        <ThumbsUp className="h-3 w-3 mr-1" />
                        {review.helpful}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 px-2">
                        <ThumbsDown className="h-3 w-3 mr-1" />
                        {review.unhelpful}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center">
        <Button variant="outline">Load More Reviews</Button>
      </div>
    </div>
  )
}
