Feature: User Authentication
  As a shopper
  I want to log in to the store
  So that I can browse products and make purchases

  Background:
    Given I am on the login page

  @smoke
  Scenario: Successful login with valid credentials
    When I enter username "standard_user" and password "secret_sauce"
    And I click the login button
    Then I should be on the products page

  @regression
  Scenario: Login fails with incorrect password
    When I enter username "standard_user" and password "wrongpassword"
    And I click the login button
    Then I should see an error message containing "Username and password do not match"

  @regression
  Scenario: Login fails for a locked out user
    When I enter username "locked_out_user" and password "secret_sauce"
    And I click the login button
    Then I should see an error message containing "Sorry, this user has been locked out"

  @regression
  Scenario: Login fails when credentials are empty
    When I click the login button
    Then I should see an error message containing "Username is required"
